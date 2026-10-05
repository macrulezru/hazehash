import { defineComponent, h, onMounted, ref, type PropType } from 'vue';
import { usePlaceholder } from './usePlaceholder';

const FILL = {
  position: 'absolute',
  inset: '0',
  width: '100%',
  height: '100%',
} as const;

export const PlaceholderImage = defineComponent({
  name: 'PlaceholderImage',
  props: {
    hash: { type: String, default: undefined },
    src: { type: String, default: undefined },
    alt: { type: String, default: '' },
    width: { type: [Number, String] as PropType<number | string>, default: undefined },
    height: { type: [Number, String] as PropType<number | string>, default: undefined },
    /** Long side of the decoded preview. */
    size: { type: Number, default: 32 },
    /** Fade-in duration of the real image, ms. */
    fade: { type: Number, default: 300 },
  },
  setup(props) {
    const { canvas, mounted, backgroundColor, aspectRatio } = usePlaceholder(() => props.hash, {
      size: () => props.size,
    });
    const img = ref<HTMLImageElement | null>(null);
    // `null` until mounted, so the server markup and the first client render are identical.
    const loaded = ref<boolean | null>(null);
    const animate = ref(true);

    onMounted(() => {
      animate.value = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      // Cached images may have loaded before hydration: trust img.complete.
      loaded.value = !!img.value?.complete && (img.value?.naturalWidth ?? 0) > 0;
    });

    const dims = () => {
      const w = Number(props.width);
      const hgt = Number(props.height);
      return w > 0 && hgt > 0 ? `${w} / ${hgt}` : undefined;
    };

    return () => {
      const ratio = dims() ?? (aspectRatio.value ? String(aspectRatio.value) : undefined);
      const rootStyle: Record<string, string> = { position: 'relative', overflow: 'hidden' };
      if (backgroundColor.value) rootStyle.backgroundColor = backgroundColor.value;
      if (ratio) rootStyle.aspectRatio = ratio;

      const children = [];
      if (mounted.value && props.hash && aspectRatio.value) {
        children.push(
          h('canvas', {
            ref: canvas,
            'aria-hidden': 'true',
            style: { ...FILL, display: 'block' },
          }),
        );
      }
      if (props.src) {
        const imgStyle: Record<string, string> = ratio
          ? { ...FILL, objectFit: 'cover' }
          : { display: 'block', width: '100%', height: 'auto' };
        if (loaded.value !== null) {
          imgStyle.opacity = loaded.value ? '1' : '0';
          imgStyle.transition =
            animate.value && props.fade > 0 ? `opacity ${props.fade}ms ease` : 'none';
        }
        children.push(
          h('img', {
            ref: img,
            src: props.src,
            alt: props.alt,
            width: props.width,
            height: props.height,
            style: imgStyle,
            onLoad: () => {
              loaded.value = true;
            },
          }),
        );
      }
      return h('div', { style: rootStyle }, children);
    };
  },
});
