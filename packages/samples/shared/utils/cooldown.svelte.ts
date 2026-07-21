export function createCooldown(getTargetTime: () => string | null | undefined) {
  let now = $state(Date.now());

  const end = $derived(
    (() => {
      const t = getTargetTime();
      if (t == null) return 0;
      return new Date(t).getTime();
    })(),
  );

  const remaining = $derived(Math.max(0, Math.ceil((end - now) / 1000)));
  const active = $derived(remaining > 0);

  $effect(() => {
    if (end <= Date.now()) return;

    now = Date.now();
    const interval = setInterval(() => {
      now = Date.now();
      if (now >= end) clearInterval(interval);
    }, 250);

    return () => clearInterval(interval);
  });

  return {
    get remaining() {
      return remaining;
    },
    get active() {
      return active;
    },
  };
}
