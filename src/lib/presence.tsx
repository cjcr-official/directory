import { createContext, use, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Who has the app open right now.
 *
 * Every signed-in session with access joins one Supabase Realtime channel and
 * says which account it is; the channel keeps the list and tells everybody
 * when it changes. Nothing is written to the database, so there is no
 * migration and nothing for the backup to carry - a closed tab simply drops
 * off the list a few seconds later.
 *
 * All that is sent is the account's id, never a name or an address. A
 * presence channel is not behind row level security, so anyone holding the
 * public anon key could listen to it, and an id means nothing without the
 * profiles table the policies do guard. For the same reason what arrives is
 * only ever used to mark rows the reader could already see: an id that
 * matches no profile is ignored.
 */
const CHANNEL = "online";

const OnlineContext = createContext<ReadonlySet<string>>(new Set());

export function PresenceProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const [online, setOnline] = useState<ReadonlySet<string>>(() => new Set([userId]));

  useEffect(() => {
    // Keyed on the account rather than the tab, so somebody with the app open
    // on a phone and a desk is one person online, not two.
    const channel = supabase.channel(CHANNEL, { config: { presence: { key: userId } } });

    channel
      .on("presence", { event: "sync" }, () => {
        const ids = new Set(Object.keys(channel.presenceState()));
        // You are here whether or not the channel has said so yet.
        ids.add(userId);
        setOnline(ids);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void channel.track({ at: new Date().toISOString() });
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return <OnlineContext value={online}>{children}</OnlineContext>;
}

/** The ids of the accounts with the app open, your own included. */
export function useOnline(): ReadonlySet<string> {
  return use(OnlineContext);
}
