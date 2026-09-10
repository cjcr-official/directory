/**
 * That asking for four hundred photographs makes one request, not four hundred.
 *
 * This is the bug the batcher exists for, and it is invisible from inside the
 * app: every face appeared, just after four hundred round trips on a phone.
 * Nothing throws when it goes wrong, so it has to be counted.
 *
 * Run with: npm run batch:check
 */

import { createBatcher } from "@/lib/batch";
import { same } from "./check";

/** A stand-in for the signing call, counting how often it is asked. */
function counted(answer: (key: string) => string | undefined = (k) => `url:${k}`) {
  const calls: string[][] = [];
  const run = async (keys: string[]) => {
    calls.push([...keys]);
    const out = new Map<string, string>();
    for (const key of keys) {
      const value = answer(key);
      if (value !== undefined) out.set(key, value);
    }
    return out;
  };
  return { calls, run };
}

console.log("\na page of faces asking one at a time");
{
  const { calls, run } = counted();
  const batcher = createBatcher(run, 100);

  // Exactly what four hundred Avatars do: each asks for its own path.
  const results = await Promise.all(
    Array.from({ length: 400 }, (_, i) => batcher.get(`people/${i}.jpg`)),
  );

  same("every face gets its URL", results.length, 400);
  same("and they are the right ones", results[7], "url:people/7.jpg");
  same("requests made", calls.length, 4);
  same(
    "all four are full batches",
    calls.map((c) => c.length),
    [100, 100, 100, 100],
  );
}

console.log("\nthe same photograph asked for by several rows at once");
{
  const { calls, run } = counted();
  const batcher = createBatcher(run, 100);

  const results = await Promise.all([
    batcher.get("households/a.jpg"),
    batcher.get("households/a.jpg"),
    batcher.get("households/a.jpg"),
    batcher.get("households/b.jpg"),
  ]);

  same("everyone is answered", results, [
    "url:households/a.jpg",
    "url:households/a.jpg",
    "url:households/a.jpg",
    "url:households/b.jpg",
  ]);
  same("one request", calls.length, 1);
  same("carrying each path once", calls[0], ["households/a.jpg", "households/b.jpg"]);
}

console.log("\nasking again while the first ask is still in the air");
{
  const { calls, run } = counted();
  const batcher = createBatcher(run, 100);

  const first = batcher.get("people/x.jpg");
  // Let the batch go out, but do not wait for it to come back.
  await Promise.resolve();
  const second = batcher.get("people/x.jpg");

  same("both get the answer", await Promise.all([first, second]), [
    "url:people/x.jpg",
    "url:people/x.jpg",
  ]);
  same("without asking twice", calls.length, 1);
}

console.log("\nasks in separate ticks are separate requests");
{
  const { calls, run } = counted();
  const batcher = createBatcher(run, 100);

  await batcher.get("a");
  await batcher.get("b");

  same("one request each", calls.length, 2);
}

console.log("\na photograph that is not there");
{
  const { calls, run } = counted((key) => (key === "gone.jpg" ? undefined : `url:${key}`));
  const batcher = createBatcher(run, 100);

  const [missing, present] = await Promise.all([batcher.get("gone.jpg"), batcher.get("here.jpg")]);
  same("the missing one resolves rather than hanging", missing, undefined);
  same("and does not take its neighbour down", present, "url:here.jpg");
  same("one request", calls.length, 1);
}

console.log("\nthe request itself failing");
{
  let calls = 0;
  const batcher = createBatcher<string, string>(async () => {
    calls += 1;
    throw new Error("network gone");
  }, 100);

  const results = await Promise.all([batcher.get("a"), batcher.get("b")]);
  same("every waiter is answered rather than left spinning", results, [undefined, undefined]);
  same("the failure did not become an unhandled rejection", calls, 1);

  // And the next ask is allowed to try again rather than being stuck.
  const again = await batcher.get("a");
  same("a later ask retries", again, undefined);
  same("as a fresh request", calls, 2);
}

console.log("\nsigning out mid-flight");
{
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const batcher = createBatcher<string, string>(async (keys) => {
    await gate;
    return new Map(keys.map((k) => [k, `url:${k}`]));
  }, 100);

  const pending = batcher.get("people/private.jpg");
  await Promise.resolve(); // the request has gone out
  batcher.reset();

  same("the waiter is let go rather than left hanging", await pending, undefined);

  // And when the answer finally lands, it is not handed to anybody: those
  // links outlive the session by up to an hour, which is the whole reason
  // sign-out clears them.
  release?.();
  const afterReset = await batcher.get("people/private.jpg");
  same(
    "a fresh ask after signing out is answered on its own terms",
    afterReset,
    "url:people/private.jpg",
  );
}
