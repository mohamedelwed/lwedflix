import { supabase } from './supabase';
import { currentUserId } from './session';
import { fetchProfiles, type PublicProfile } from './friends';
import { REACTION_EMOJI, type Reaction } from './posts';

export type NotificationType =
  | 'post'
  | 'comment'
  | 'reaction'
  | 'friend_request'
  | 'friend_accepted'
  | 'recommendation'
  | 'dm';

export interface AppNotification {
  id: string;
  type: NotificationType;
  actor: PublicProfile | null;
  post_id: string | null;
  comment_id: string | null;
  reaction: Reaction | null;
  media_title: string | null;
  thread_id: string | null;
  read_at: string | null;
  created_at: string;
}

interface NotificationRow {
  id: string;
  user_id: string;
  actor_id: string;
  type: NotificationType;
  post_id: string | null;
  comment_id: string | null;
  reaction: Reaction | null;
  media_title: string | null;
  thread_id: string | null;
  read_at: string | null;
  created_at: string;
}

/**
 * Recent notifications with actor profiles attached.
 *
 * Two queries rather than a join — PostgREST can't auto-join to
 * `profiles_public` because a view carries no foreign keys.
 */
export async function getNotifications(limit = 20): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = data as NotificationRow[];
  const profiles = await fetchProfiles(rows.map((r) => r.actor_id));

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    actor: profiles.get(r.actor_id) ?? null,
    post_id: r.post_id,
    comment_id: r.comment_id,
    reaction: r.reaction,
    media_title: r.media_title ?? null,
    thread_id: r.thread_id ?? null,
    read_at: r.read_at,
    created_at: r.created_at,
  }));
}

export async function getUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);

  if (error) throw error;
  return count ?? 0;
}

export async function markRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Removes a single notification. */
export async function clearNotification(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').delete().eq('id', id);
  if (error) throw error;
}

/** Empties the whole list. Read history is gone for good, hence the confirm upstream. */
export async function clearAllNotifications(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;

  const { error } = await supabase.from('notifications').delete().eq('user_id', userId);
  if (error) throw error;
}

export async function markAllRead(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
}

/**
 * Live updates for one user's notifications.
 *
 * A plain `user_id=eq.<id>` equality filter — unlike `in.(...)` lists,
 * which have been unreliable across supabase-js/realtime versions, this
 * form is dependable. RLS also scopes the stream server-side, so the
 * filter is an optimization rather than the security boundary.
 *
 * Requires `notifications` to be in the supabase_realtime publication
 * (0002 does this). Without it the subscription silently receives nothing.
 */
export function subscribeToNotifications(userId: string, onChange: () => void): () => void {
  // A channel of its own per subscriber (as dm.ts and posts.ts do):
  // supabase.channel() hands back an existing channel of the same name, and
  // a second listener can't join one already subscribed — the phone app's
  // tabs each have a top bar that subscribes.
  const channel = supabase
    .channel(`notifications:${userId}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      () => onChange()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/** Human-readable summary for a notification row. */
export function describeNotification(n: AppNotification): string {
  const who = n.actor?.display_name || (n.actor ? `@${n.actor.username}` : 'Someone');
  switch (n.type) {
    case 'comment':
      return `${who} commented on your post`;
    case 'reaction':
      return `${who} reacted ${n.reaction ? REACTION_EMOJI[n.reaction] : ''} to your post`;
    case 'post':
      return `${who} shared a new post`;
    case 'friend_request':
      return `${who} sent you a friend request`;
    case 'friend_accepted':
      return `${who} is now your friend`;
    case 'recommendation':
      return `${who} recommended ${n.media_title ?? 'something'} to you`;
    case 'dm':
      return `${who} sent you a message`;
    default:
      return `${who} did something`;
  }
}

/** Where clicking a notification should land. */
export function notificationHref(n: AppNotification): string {
  switch (n.type) {
    case 'friend_request':
    case 'friend_accepted':
      return '/friends?tab=people';
    case 'recommendation':
      return '/watchlist';
    case 'dm':
      return n.thread_id ? `/messages?thread=${n.thread_id}` : '/messages';
    default:
      // Straight to the post itself rather than the feed.
      return n.post_id ? `/p/${n.post_id}` : '/friends?tab=feed';
  }
}
