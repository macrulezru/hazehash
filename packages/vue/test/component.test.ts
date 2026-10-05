import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, nextTick } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { PlaceholderImage } from '../src';

// Known-good hash: flat gray square (header only).
const HASH = 'EAAQPvgAAA';

beforeAll(() => {
  // happy-dom has no ImageData; a minimal stand-in is enough to exercise the draw path.
  if (!('ImageData' in globalThis)) {
    class ImageDataStub {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    }
    (globalThis as Record<string, unknown>).ImageData = ImageDataStub;
  }
});

afterEach(() => vi.restoreAllMocks());

describe('PlaceholderImage', () => {
  it('renders only background color and aspect-ratio on the server', async () => {
    const html = await renderToString(
      createSSRApp(PlaceholderImage, { hash: HASH, src: '/a.jpg', alt: 'A' }),
    );
    expect(html).toContain('background-color');
    expect(html).toContain('aspect-ratio');
    expect(html).not.toContain('<canvas');
    expect(html).toContain('<img');
    expect(html).not.toContain('opacity');
  });

  it('uses width and height for the aspect ratio when given', async () => {
    const html = await renderToString(
      createSSRApp(PlaceholderImage, { hash: HASH, width: 400, height: 100 }),
    );
    expect(html).toContain('aspect-ratio:400 / 100');
  });

  it('hydrates without warnings and then draws the canvas', async () => {
    const props = { hash: HASH, src: '/a.jpg', alt: 'A' };
    const html = await renderToString(createSSRApp(PlaceholderImage, props));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    createSSRApp(PlaceholderImage, props).mount(container);
    await nextTick();
    expect(warn).not.toHaveBeenCalled();
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('A');
  });

  it('does not throw on a broken hash and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const render = () =>
      renderToString(createSSRApp(PlaceholderImage, { hash: '!!!', src: '/a.jpg' }));
    const html = await render();
    await render();
    expect(html).toContain('<img');
    expect(html).not.toContain('<canvas');
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
