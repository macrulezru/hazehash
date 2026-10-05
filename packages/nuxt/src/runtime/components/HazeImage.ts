import { defineComponent, h, type PropType } from 'vue';
import { PlaceholderImage } from 'hazehash-vue';
import { useHazeHash } from '../composables';

/**
 * PlaceholderImage that falls back to the build-time hash of `src` when no `hash` prop is given.
 */
export default defineComponent({
  name: 'HazeImage',
  props: {
    hash: { type: String, default: undefined },
    src: { type: String, default: undefined },
    alt: { type: String, default: '' },
    width: { type: [Number, String] as PropType<number | string>, default: undefined },
    height: { type: [Number, String] as PropType<number | string>, default: undefined },
    size: { type: Number, default: 32 },
    fade: { type: Number, default: 300 },
  },
  setup(props) {
    const generated = useHazeHash(() => props.src);
    return () => h(PlaceholderImage, { ...props, hash: props.hash ?? generated.value });
  },
});
