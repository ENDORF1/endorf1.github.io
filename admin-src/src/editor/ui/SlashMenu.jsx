import { useEffect, useRef } from 'preact/hooks';
import { Icon } from '../../shared/icons.jsx';
import { Floating, MenuItem } from './Floating.jsx';

export function SlashMenu({ app, slash }) {
  const listRef = useRef(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector('.is-selected');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [slash.index, slash.query]);

  if (!slash.items.length) {
    if (!slash.query || slash.query.length > 12) return null;
    return (
      <Floating getRect={slash.getRect} placement="bottom-start" offset={6} fallback={['top-start']} className="ui-panel" keepFocus>
        <div class="ui-menu-empty">没有匹配“{slash.query}”的块，按 Esc 关闭</div>
      </Floating>
    );
  }
  let lastGroup = null;
  return (
    <Floating getRect={slash.getRect} placement="bottom-start" offset={6} fallback={['top-start']} className="ui-panel" keepFocus>
      <div class="ui-menu" ref={listRef} style={{ width: '280px' }}>
        {slash.items.map((item, i) => {
          const header = !slash.query && item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          return (
            <>
              {header && <div class="ui-menu-group">{header}</div>}
              <MenuItem icon={<Icon name={item.icon} />} title={item.title} desc={item.desc} kbd={item.kbd}
                selected={i === slash.index} onMouseEnter={() => app.slash.hover(i)} onClick={() => app.slash.select(i)} />
            </>
          );
        })}
      </div>
    </Floating>
  );
}
