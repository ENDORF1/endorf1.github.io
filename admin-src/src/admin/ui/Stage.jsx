import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './common.jsx';
import { DEVICES } from './TopBar.jsx';

function useSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return size;
}

export function Stage({ shell, st }) {
  const hostRef = useRef(null);
  const slotRef = useRef(null);
  const size = useSize(hostRef);
  const device = DEVICES.find(d => d.id === st.device) || DEVICES[0];
  const found = st.currentId ? shell.data.find(st.currentId) : null;
  const conflict = found && st.conflicts.includes(st.currentId);

  useEffect(() => {
    shell.mountCanvas(slotRef.current);
  }, []);

  useLayoutEffect(() => {
    const frame = shell.canvas && shell.canvas.iframe;
    if (!frame || !size.width) return;
    let width = size.width;
    let height = size.height;
    let scale = 1;
    let left = 0;
    let top = 0;
    if (device.width) {
      const gutter = device.id === 'desktop' ? 0 : 24;
      const avail = size.width - gutter * 2;
      width = device.width;
      scale = Math.min(1, avail / width);
      height = (size.height - (device.id === 'desktop' ? 0 : 24)) / scale;
      left = Math.max(0, (size.width - width * scale) / 2);
      top = device.id === 'desktop' ? 0 : 12;
    }
    frame.style.width = `${Math.round(width)}px`;
    frame.style.height = `${Math.round(height)}px`;
    frame.style.transform = `translate(${Math.round(left)}px, ${top}px)${scale < 1 ? ` scale(${scale})` : ''}`;
  }, [size.width, size.height, device.id, st.editorReady]);

  const scale = device.width ? Math.min(1, (size.width - (device.id === 'desktop' ? 0 : 48)) / device.width) : 1;

  return (
    <section class="stage">
      {conflict && (
        <div class="banner">
          <Icon name="alert" size={14} />
          这篇文档在别处发布过新版本。你现在看到的是本机的草稿。
          <button type="button" class="btn is-small" onClick={async () => {
            const ok = await shell.confirm({ title: '用线上版本替换本机草稿？', text: '本机草稿会先存进历史版本，可以随时找回。', ok: '使用线上版本' });
            if (!ok) return;
            await shell.data.discardLocal(st.currentId);
            shell.store.set(s => ({ conflicts: s.conflicts.filter(x => x !== st.currentId) }));
            shell.openDoc(st.currentId, { force: true });
          }}>使用线上版本</button>
          <button type="button" class="btn is-small is-ghost" onClick={() => shell.store.set(s => ({ conflicts: s.conflicts.filter(x => x !== st.currentId) }))}>保留本机草稿</button>
        </div>
      )}
      <div class={`canvas-host${device.width ? ' is-device' : ''}`} ref={hostRef}>
        <div class="canvas-slot" ref={slotRef} />
        {(!st.editorReady) && <div class="canvas-loading"><div class="boot-msg"><span class="spinner" />正在启动编辑器…</div></div>}
        {st.editorReady && !found && (
          <div class="canvas-empty">
            <div>
              <h2>选择或新建一篇文档</h2>
              <div class="muted">左侧是网站上的全部内容。编辑区的样子就是发布后的样子。</div>
              <div class="row">
                <button type="button" class="btn is-primary" onClick={() => shell.createDoc('post')}><Icon name="plus" size={14} />新建文章</button>
                <button type="button" class="btn" onClick={() => shell.createDoc('work')}><Icon name="gamepad" size={14} />新建项目</button>
              </div>
            </div>
          </div>
        )}
        {device.width && <div class="device-label">{device.label} · {device.width}px{scale < 1 ? ` · 缩放 ${Math.round(scale * 100)}%` : ''}</div>}
      </div>
    </section>
  );
}
