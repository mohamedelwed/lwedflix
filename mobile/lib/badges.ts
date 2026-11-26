import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getUnreadTotal, subscribeToMessages } from '@shared/lib/dm';
import { getIncomingRequestCount } from '@shared/lib/friends';
import { getUnreadCount, subscribeToNotifications } from '@shared/lib/notifications';
import { useAuth } from './auth';

/** Counts for the badges: friend requests, unread messages, notifications (src/hooks/useNavBadges.ts). */
export function useNavBadges() {
  const { user } = useAuth();
  const [requests, setRequests] = useState(0);
  const [messages, setMessages] = useState(0);
  const [notifications, setNotifications] = useState(0);

  useEffect(() => {
    if (!user) return;
    let live = true;
    const refresh = () => {
      getIncomingRequestCount().then((n) => live && setRequests(n), () => {});
      getUnreadTotal().then((n) => live && setMessages(n), () => {});
      getUnreadCount().then((n) => live && setNotifications(n), () => {});
    };
    refresh();
    const stopMessages = subscribeToMessages(() => refresh());
    const stopNotifications = subscribeToNotifications(user.id, refresh);
    const sub = AppState.addEventListener('change', (state) => state === 'active' && refresh());
    return () => {
      live = false;
      stopMessages();
      stopNotifications();
      sub.remove();
    };
  }, [user]);

  return user ? { requests, messages, notifications } : { requests: 0, messages: 0, notifications: 0 };
}
