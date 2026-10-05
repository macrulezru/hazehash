import { computed, onMounted, ref, toValue, watchEffect, type MaybeRefOrGetter } from 'vue';
import { getAspectRatio, getAverageColor } from 'hazehash';
import { drawToCanvas } from 'hazehash/canvas';

let warned = false;

function warnOnce(error: unknown): void {
  if (warned) return;
  warned = true;
  console.warn('[hazehash-vue] invalid placeholder hash:', error);
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (error) {
    warnOnce(error);
    return undefined;
  }
}

export interface UsePlaceholderOptions {
  /** Long side of the decoded preview, default 32. */
  size?: MaybeRefOrGetter<number | undefined>;
}

/**
 * Reactive placeholder state. On the server only `backgroundColor` and `aspectRatio` are
 * meaningful; the canvas is drawn after mount, so hydration never mismatches.
 */
export function usePlaceholder(
  hash: MaybeRefOrGetter<string | Uint8Array | undefined | null>,
  options: UsePlaceholderOptions = {},
) {
  const canvas = ref<HTMLCanvasElement | null>(null);
  const mounted = ref(false);

  const average = computed(() => {
    const h = toValue(hash);
    return h ? safe(() => getAverageColor(h)) : undefined;
  });
  const aspectRatio = computed(() => {
    const h = toValue(hash);
    return h ? safe(() => getAspectRatio(h)) : undefined;
  });
  const backgroundColor = computed(() => {
    const c = average.value;
    return c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})` : undefined;
  });

  onMounted(() => {
    mounted.value = true;
  });

  watchEffect(() => {
    const el = canvas.value;
    const h = toValue(hash);
    if (!mounted.value || !el || !h || !aspectRatio.value) return;
    safe(() => drawToCanvas(h, el, { size: toValue(options.size) ?? 32 }));
  });

  return { canvas, mounted, average, aspectRatio, backgroundColor };
}
