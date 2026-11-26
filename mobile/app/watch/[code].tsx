import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronLeft, ChevronRight, Copy, Lock, Play, Popcorn, Send, Share2 } from 'lucide-react-native';
import {
  buildRoomUrl,
  cleanName,
  DRIFT_TOLERANCE_SECONDS,
  formatDrift,
  formatTimestamp,
  getGuest,
  getStartedTitle,
  joinParty,
  partyHost,
  rememberTitle,
  saveGuestName,
  type PartyChatMessage,
  type PartyConnection,
  type PartyMember,
  type PartyTitle,
} from '@shared/lib/watchRoom';
import { fetchProfiles } from '@shared/lib/friends';
import { timeAgo } from '@shared/lib/posts';
import { PartySync, isPartyMessage } from '@shared/lib/partySync';
import Avatar from '@/components/Avatar';
import Field from '@/components/Field';
import PrimaryButton from '@/components/PrimaryButton';
import { EmptyState, Loading } from '@/components/States';
import { ReactionBar, ReactionsOverlay, type FloatingReaction } from '@/components/party/Reactions';
import PlayerView from '@/player/PlayerView';
import UpNextCard from '@/player/UpNextCard';
import { usePlaybackTracking } from '@/player/usePlaybackTracking';
import type { PlayerHandle, PlayerState } from '@/player/types';
import { adjacentEpisode, type EpisodeRef } from '@/lib/episodes';
import { useAuth } from '@/lib/auth';
import { colors, radius, space } from '@/theme';

interface Identity {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
}

const EMPTY_AFTER_MS = 6000;
const REACTION_MS = 2800;

/**
 * A watch party (src/app/watch/[code]/page.tsx): the same Realtime room and
 * sync (watchRoom.ts, partySync.ts) as the desktop app, so phones and
 * computers watch together.
 */
export default function WatchPartyScreen() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = (params.code ?? '').toUpperCase();
  const insets = useSafeAreaInsets();
  const { user, loading: authLoading } = useAuth();

  // ---- Who you are in the room ----
  const [profile, setProfile] = useState<Identity | null>(null);
  useEffect(() => {
    if (!user) return;
    let live = true;
    const fallback: Identity = { id: user.id, name: 'Member', username: null, avatarUrl: null };
    fetchProfiles([user.id])
      .then((profiles) => {
        if (!live) return;
        const p = profiles.get(user.id);
        setProfile(p ? { id: user.id, name: cleanName(p.display_name || p.username) || 'Member', username: p.username, avatarUrl: p.avatar_url } : fallback);
      })
      .catch(() => live && setProfile(fallback));
    return () => {
      live = false;
    };
  }, [user]);

  const guest = useMemo(() => (!authLoading && !user ? getGuest() : null), [authLoading, user]);
  const [guestName, setGuestName] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const needsName = Boolean(guest && !(guestName ?? guest.name));

  const identity = useMemo<Identity | null>(() => {
    if (user) return profile?.id === user.id ? profile : null;
    const name = guestName ?? guest?.name;
    return guest && name ? { id: guest.id, name, username: null, avatarUrl: null } : null;
  }, [user, profile, guest, guestName]);

  // ---- Room state ----
  const [members, setMembers] = useState<PartyMember[]>([]);
  const [messages, setMessages] = useState<PartyChatMessage[]>([]);
  const [isEmpty, setIsEmpty] = useState(false);
  const [startsAt, setStartsAt] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState('');
  const [syncHint, setSyncHint] = useState<string | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [playerState, setPlayerState] = useState<PlayerState | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const connectionRef = useRef<PartyConnection | null>(null);
  const syncRef = useRef<PartySync | null>(null);
  const player = useRef<PlayerHandle>(null);
  const myPosition = useRef<{ watched: number; duration: number; episodeKey: string | null } | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const host = partyHost(members);
  const amHost = Boolean(identity && host?.id === identity.id);
  const [lockPlayback, setLockPlayback] = useState(false);
  const lockRef = useRef(false);
  const hostOnly = amHost ? lockPlayback : Boolean(host?.hostOnly);
  const membersRef = useRef<PartyMember[]>([]);
  const amHostRef = useRef(false);
  const hostOnlyRef = useRef(false);
  membersRef.current = members;
  amHostRef.current = amHost;
  hostOnlyRef.current = hostOnly;

  const startedTitle = useMemo(() => getStartedTitle(code), [code]);
  const [changedTitle, setChangedTitle] = useState<PartyTitle | null>(null);
  const [liveEpisode, setLiveEpisode] = useState<(EpisodeRef & { by: string }) | null>(null);
  const myTitle = changedTitle ?? startedTitle;
  const carrier = partyHost(members.filter((m) => m.title));
  let title: PartyTitle | null = null;
  if (amHost || !carrier?.title) {
    title = myTitle ?? carrier?.title ?? null;
  } else {
    title = carrier.title;
    if (title.mediaType === 'tv' && liveEpisode && liveEpisode.by === host?.id) title = { ...title, season: liveEpisode.season, episode: liveEpisode.episode };
  }
  const titleKey = title ? JSON.stringify(title) : null;
  const episodeKey = title?.mediaType === 'tv' ? `${title.mediaId}:${title.season ?? 1}:${title.episode ?? 1}` : null;

  const flashHint = useCallback((text: string, ms = 5000) => {
    setSyncHint(text);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setSyncHint(null), ms);
  }, []);

  useEffect(() => {
    if (!identity || !code) return;
    const reactionTimers = new Set<ReturnType<typeof setTimeout>>();
    const connection = joinParty(
      code,
      { ...identity, joinedAt: Date.now(), title: getStartedTitle(code), hostOnly: lockRef.current },
      {
        onMembers: setMembers,
        onChat: (message) => setMessages((prev) => [...prev, message].slice(-200)),
        onHistory: setMessages,
        onCountdown: setStartsAt,
        onSync: (message) => {
          if (syncRef.current && isPartyMessage(message)) syncRef.current.handleRemote(message);
        },
        onEpisode: (change) => {
          const h = partyHost(membersRef.current);
          if (change.by !== h?.id) return;
          setLiveEpisode(change);
          flashHint(`${h.name} moved the party to S${change.season} · E${change.episode}`);
        },
        onReaction: (reaction) => {
          const floating: FloatingReaction = { id: reaction.id, emoji: reaction.emoji, name: reaction.by === identity.id ? 'You' : reaction.name, x: 8 + Math.random() * 80 };
          setReactions((prev) => [...prev, floating].slice(-30));
          const t = setTimeout(() => {
            reactionTimers.delete(t);
            setReactions((prev) => prev.filter((r) => r.id !== floating.id));
          }, REACTION_MS);
          reactionTimers.add(t);
        },
      }
    );
    connectionRef.current = connection;
    const emptyTimer = setTimeout(() => setIsEmpty(true), EMPTY_AFTER_MS);

    const partySync = new PartySync({
      me: identity.id,
      isHost: () => amHostRef.current,
      send: (message) => connection.sync(message),
      command: (command) => player.current?.command(command),
      onRemoteAction: (state) => {
        const name = membersRef.current.find((m) => m.id === state.by)?.name ?? 'Someone';
        const did = state.cause === 'pause' ? 'paused at' : state.cause === 'seeked' ? 'jumped to' : 'pressed play at';
        flashHint(`${name} ${did} ${formatTimestamp(state.time)}`);
      },
      canControl: () => amHostRef.current || !hostOnlyRef.current,
      onBlocked: () => flashHint('Only the host controls playback in this party'),
    });
    syncRef.current = partySync;
    const ticker = setInterval(() => partySync.tick(), 1000);

    return () => {
      clearTimeout(emptyTimer);
      clearInterval(ticker);
      reactionTimers.forEach(clearTimeout);
      syncRef.current = null;
      connection.leave();
      connectionRef.current = null;
    };
  }, [identity, code, flashHint]);

  useEffect(() => {
    if (titleKey) connectionRef.current?.setTitle(JSON.parse(titleKey));
  }, [titleKey]);

  useEffect(() => {
    if (!startsAt) return;
    const tick = () => {
      const remaining = Math.ceil((startsAt - Date.now()) / 1000);
      setCountdown(remaining > 0 ? remaining : null);
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [startsAt]);

  useEffect(() => {
    const t = setInterval(() => {
      const measured = myPosition.current;
      if (!measured) return;
      connectionRef.current?.reportPosition({ position: measured.watched, duration: measured.duration, positionSource: 'measured', episodeKey: measured.episodeKey });
    }, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!startsAt || !amHost) return;
    const delay = startsAt - Date.now();
    if (delay <= 0) return;
    const t = setTimeout(() => {
      player.current?.command({ action: 'seek', time: 0 });
      player.current?.command({ action: 'play' });
    }, delay);
    return () => clearTimeout(t);
  }, [startsAt, amHost]);

  const [upNext, setUpNext] = useState<{ key: string; next: EpisodeRef | null } | null>(null);
  useEffect(() => {
    if (!episodeKey || !amHost) return;
    const [showId, season, episode] = episodeKey.split(':');
    let live = true;
    void adjacentEpisode(showId, { season: Number(season), episode: Number(episode) }, 1).then((next) => live && setUpNext({ key: episodeKey, next }));
    return () => {
      live = false;
    };
  }, [episodeKey, amHost]);
  const nextEpisode = upNext?.key === episodeKey ? upNext.next : null;
  const atLastEpisode = upNext?.key === episodeKey && upNext.next === null;

  const changeEpisode = (to: EpisodeRef) => {
    if (!title || title.mediaType !== 'tv') return;
    const next: PartyTitle = { ...title, season: to.season, episode: to.episode };
    setChangedTitle(next);
    rememberTitle(code, next);
    connectionRef.current?.episode(to.season, to.episode);
    myPosition.current = null;
    flashHint(`Moved the party to S${to.season} · E${to.episode}`);
  };

  const [stepping, setStepping] = useState(false);
  const stepEpisode = async (direction: 1 | -1) => {
    if (!title || title.mediaType !== 'tv') return;
    setStepping(true);
    try {
      const to = await adjacentEpisode(title.mediaId, { season: title.season ?? 1, episode: title.episode ?? 1 }, direction);
      if (to) changeEpisode(to);
      else flashHint(direction === 1 ? "That's the last episode" : "That's the first episode");
    } finally {
      setStepping(false);
    }
  };

  const media = {
    type: title?.mediaType ?? ('movie' as const),
    id: Number(title?.mediaId ?? 0),
    title: title?.title ?? '',
    posterPath: title?.posterPath,
    season: title?.season ?? 1,
    episode: title?.episode ?? 1,
  };
  const track = usePlaybackTracking(media, !!title && streamReady);
  const onState = useCallback(
    (state: PlayerState | null) => {
      syncRef.current?.handleLocal(state);
      setStreamReady(state !== null);
      setPlayerState(state);
      track(state);
      if (state && state.duration > 0) myPosition.current = { watched: state.time, duration: state.duration, episodeKey };
    },
    [track, episodeKey]
  );

  useEffect(() => {
    void (fullscreen
      ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
      : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).then(() => ScreenOrientation.unlockAsync()));
  }, [fullscreen]);

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    connectionRef.current?.chat(body);
  };

  // ---- Render ----
  if (needsName) {
    const name = cleanName(nameDraft);
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Popcorn size={48} color={colors.accent} />
        <Text style={styles.bigTitle}>Join the watch party</Text>
        <Text style={styles.muted}>Pick a name so friends know who's here. No account needed.</Text>
        <View style={{ alignSelf: 'stretch', gap: space.md }}>
          <Field label="Your name" value={nameDraft} onChangeText={(t) => setNameDraft(t.slice(0, 30))} autoFocus placeholder="Your name" onSubmitEditing={() => name && setGuestName(saveGuestName(name).name)} />
          <PrimaryButton label="Join party" disabled={!name} onPress={() => setGuestName(saveGuestName(name).name)} />
          <PrimaryButton label="Sign in instead" secondary onPress={() => router.push({ pathname: '/login', params: { redirect: `/watch/${code}` } })} />
        </View>
      </View>
    );
  }

  if (!identity || (!title && !isEmpty)) return <Loading />;

  if (!title) {
    return (
      <EmptyState
        title="No one's here"
        text={`Party ${code} is empty — it may have ended, or the code is mistyped. This screen joins automatically if someone comes back.`}
        action={{ label: 'Enter another code', onPress: () => router.replace('/watch') }}
      />
    );
  }

  const me = members.find((m) => m.id === identity.id);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: fullscreen ? '#000' : colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar hidden={fullscreen} style="light" />
      <View style={{ height: fullscreen ? 0 : insets.top, backgroundColor: '#000' }} />
      <PlayerView
        ref={player}
        media={media}
        fullscreen={fullscreen}
        onFullscreenChange={setFullscreen}
        onState={onState}
        onBack={() => (fullscreen ? setFullscreen(false) : router.back())}
        onNext={amHost && nextEpisode ? () => changeEpisode(nextEpisode) : undefined}
        overlay={
          <>
            <ReactionsOverlay reactions={reactions} />
            {amHost && nextEpisode && episodeKey && <UpNextCard key={episodeKey} state={playerState} next={nextEpisode} onPlayNext={() => changeEpisode(nextEpisode)} />}
          </>
        }
      />

      {countdown !== null && (
        <View style={styles.countdown} pointerEvents="none">
          <Text style={styles.countdownLabel}>Starting in</Text>
          <Text style={styles.countdownNumber}>{countdown}</Text>
        </View>
      )}

      {!fullscreen && (
        <>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <View style={styles.partyIcon}>
                <Popcorn size={22} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{title.title}</Text>
                <Text style={styles.muted}>
                  Party {code} · {members.length} {members.length === 1 ? 'person' : 'people'}
                  {title.season != null ? ` · S${title.season}E${title.episode ?? 1}` : ''}
                </Text>
              </View>
            </View>

            <ReactionBar onReact={(emoji) => connectionRef.current?.react(emoji)} />

            {title.mediaType === 'tv' &&
              (amHost ? (
                <View style={styles.stepper}>
                  <Pressable onPress={() => void stepEpisode(-1)} disabled={stepping || ((title.season ?? 1) <= 1 && (title.episode ?? 1) <= 1)} hitSlop={8}>
                    <ChevronLeft color={colors.white70} size={20} />
                  </Pressable>
                  <Text style={styles.stepperText}>S{title.season ?? 1} · E{title.episode ?? 1}</Text>
                  <Pressable onPress={() => void stepEpisode(1)} disabled={stepping || atLastEpisode} hitSlop={8}>
                    <ChevronRight color={colors.white70} size={20} />
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.muted}>S{title.season ?? 1} · E{title.episode ?? 1} · the host picks episodes</Text>
              ))}

            {syncHint && <Text style={styles.hint}>{syncHint}</Text>}

            <View style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={[styles.dot, { backgroundColor: streamReady ? colors.accent : colors.white20 }]} />
                <Text style={[styles.small, { flex: 1 }]}>
                  {hostOnly && !amHost ? 'Synced playback — the host plays, pauses and skips for everyone.' : 'Synced playback — play, pause or skip and everyone follows.'}
                </Text>
              </View>
              {amHost ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Lock size={14} color={colors.muted} />
                  <Text style={[styles.small, { flex: 1 }]}>Only I control playback</Text>
                  <Switch
                    value={lockPlayback}
                    trackColor={{ true: colors.accent, false: colors.white20 }}
                    thumbColor="#fff"
                    onValueChange={(on) => {
                      setLockPlayback(on);
                      lockRef.current = on;
                      connectionRef.current?.setHostOnly(on);
                    }}
                  />
                </View>
              ) : (
                hostOnly && <Text style={styles.small}>Playback is locked to {host?.name ?? 'the host'} — pausing or skipping snaps you back to the room.</Text>
              )}
              {!streamReady && <Text style={[styles.small, { color: '#eab308' }]}>Press play in the player once to load your stream — you'll jump to wherever the room is.</Text>}
              <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                <SmallButton
                  icon={copied ? Check : Copy}
                  label={copied ? 'Copied' : `Code ${code}`}
                  onPress={async () => {
                    await Clipboard.setStringAsync(code);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                />
                <SmallButton icon={Share2} label="Invite" onPress={() => void Share.share({ message: `Watch ${title!.title} with me on Lwedflix: ${buildRoomUrl(code)} (code ${code})` })} />
                {amHost && <SmallButton icon={Play} label="Start countdown" primary onPress={() => connectionRef.current?.countdown(5)} />}
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>In the room</Text>
              {members.map((m) => {
                const isMe = m.id === identity.id;
                const theirs = m.episodeKey === episodeKey ? m.position : null;
                const mine = me?.episodeKey === episodeKey ? me.position : null;
                const drift = (theirs ?? 0) - (mine ?? 0);
                const offBy = Math.abs(drift);
                const known = isMe || (theirs !== null && mine !== null);
                return (
                  <Pressable key={m.id} style={styles.member} disabled={isMe || !m.username} onPress={() => m.username && router.push(`/u/${m.username}`)}>
                    <Avatar uri={m.avatarUrl} size={32} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {isMe ? 'You' : m.name}
                        {m.id === host?.id ? '  · host' : ''}
                        {!m.username && !isMe ? '  · guest' : ''}
                      </Text>
                      <Text style={styles.small}>
                        {!known
                          ? theirs === null
                            ? 'no position yet'
                            : 'press play to compare'
                          : isMe
                            ? 'reference'
                            : offBy <= DRIFT_TOLERANCE_SECONDS
                              ? 'in sync'
                              : `${formatDrift(drift)} ${drift > 0 ? 'ahead' : 'behind'}`}
                      </Text>
                    </View>
                    {!isMe && known && <View style={[styles.dot, { backgroundColor: offBy <= DRIFT_TOLERANCE_SECONDS ? colors.accent : '#eab308' }]} />}
                  </Pressable>
                );
              })}
              {members.length <= 1 && <Text style={styles.small}>Share the code to bring friends in.</Text>}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Chat</Text>
              {messages.length === 0 ? (
                <Text style={[styles.small, { textAlign: 'center', paddingVertical: space.md }]}>No messages yet.</Text>
              ) : (
                messages.map((m) => (
                  <View key={m.id} style={{ flexDirection: 'row', gap: space.sm }}>
                    <Avatar uri={m.avatarUrl} size={26} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.small}>
                        <Text style={{ fontWeight: '700', color: colors.white90 }}>{m.by === identity.id ? 'You' : m.name}</Text> · {timeAgo(new Date(m.at).toISOString())}
                      </Text>
                      <Text style={styles.chatBody}>{m.body}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
          <View style={[styles.chatBar, { paddingBottom: insets.bottom + space.sm }]}>
            <TextInput
              value={draft}
              onChangeText={(t) => setDraft(t.slice(0, 500))}
              placeholder="Say something…"
              placeholderTextColor={colors.muted}
              selectionColor={colors.accent}
              style={styles.chatInput}
              onSubmitEditing={send}
              returnKeyType="send"
            />
            <Pressable onPress={send} disabled={!draft.trim()} style={[styles.sendButton, !draft.trim() && { opacity: 0.4 }]} accessibilityLabel="Send">
              <Send size={16} color="#000" />
            </Pressable>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

function SmallButton({ icon: Icon, label, onPress, primary }: { icon: typeof Copy; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.smallButton, primary && { backgroundColor: colors.accent, borderColor: colors.accent }, pressed && { opacity: 0.7 }]}>
      <Icon size={14} color={primary ? '#000' : colors.foreground} />
      <Text style={[styles.smallButtonText, primary && { color: '#000' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  bigTitle: { color: colors.foreground, fontSize: 24, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 13, textAlign: 'left' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  partyIcon: { width: 44, height: 44, borderRadius: radius.lg, backgroundColor: 'rgba(255,153,0,0.15)', borderWidth: 1, borderColor: 'rgba(255,153,0,0.2)', alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.foreground, fontSize: 20, fontWeight: '800' },
  stepper: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: space.md, paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.white5, borderWidth: 1, borderColor: colors.hairline },
  stepperText: { color: colors.foreground, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hint: { color: colors.accent, fontSize: 12, padding: space.md, borderRadius: radius.md, backgroundColor: 'rgba(255,153,0,0.1)', borderWidth: 1, borderColor: 'rgba(255,153,0,0.2)', overflow: 'hidden' },
  card: { padding: space.lg, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: colors.white5, gap: space.md },
  cardTitle: { color: colors.foreground, fontWeight: '700', fontSize: 15 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  smallButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.md, backgroundColor: colors.white5, borderWidth: 1, borderColor: colors.hairline },
  smallButtonText: { color: colors.foreground, fontSize: 12, fontWeight: '700' },
  member: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  memberName: { color: colors.foreground, fontSize: 13, fontWeight: '700' },
  chatBody: { color: colors.white90, fontSize: 14, lineHeight: 19 },
  chatBar: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.white5, backgroundColor: colors.background },
  chatInput: { flex: 1, color: colors.foreground, backgroundColor: colors.white5, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline, paddingHorizontal: space.md, paddingVertical: 10, fontSize: 15 },
  sendButton: { width: 44, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  countdown: { ...StyleSheet.absoluteFill, zIndex: 200, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', gap: space.md },
  countdownLabel: { color: colors.white60, fontSize: 13, letterSpacing: 3, textTransform: 'uppercase' },
  countdownNumber: { color: colors.accent, fontSize: 96, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
