import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { useStore } from '../store.js';
import { BlockHandle, BlockMenu } from './BlockHandle.jsx';
import { SlashMenu } from './SlashMenu.jsx';
import {
  BubbleMenu, LinkEditor, LinkView, FigureTools, AltEditor, FigureBadges,
  EmbedTools, EmbedPrompt, PasteUrlOffer, TableTools, CodeTools, CalloutPicker,
} from './Toolbars.jsx';
import { FieldPopover, HeaderAddRow } from './Fields.jsx';
import { FindBar } from './FindBar.jsx';

function inTable(state) {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'table') return true;
  return false;
}

function codeBlockPos(state) {
  const $from = state.selection.$from;
  if ($from.parent.type.name === 'codeBlock') return $from.before();
  return null;
}

function SelectionTools({ app, st }) {
  const ed = app.editor;
  const { state, view } = ed;
  const sel = state.selection;
  const focused = view.hasFocus();
  const out = [];
  if (sel instanceof NodeSelection) {
    const n = sel.node.type.name;
    if (n === 'figure') out.push(<FigureTools key={'fig' + sel.from} app={app} pos={sel.from} node={sel.node} />);
    else if (n === 'embed') out.push(<EmbedTools key={'emb' + sel.from} app={app} pos={sel.from} node={sel.node} />);
  }
  if (!focused) return out.length ? <>{out}</> : null;
  if (sel instanceof CellSelection || (inTable(state) && !(sel instanceof NodeSelection))) {
    out.push(<TableTools key="table" app={app} />);
  }
  if (sel instanceof TextSelection && !sel.empty && !sel.$from.parent.type.spec.code && !st.selecting && !(sel instanceof CellSelection)) {
    out.push(<BubbleMenu key="bubble" app={app} />);
  } else if (sel instanceof TextSelection && sel.empty && ed.isActive('link')) {
    out.push(<LinkView key="link" app={app} />);
  }
  return out.length ? <>{out}</> : null;
}

function MenuHost({ app, menu }) {
  if (menu.type === 'block') return <BlockMenu app={app} menu={menu} />;
  if (menu.type === 'link') return <LinkEditor app={app} menu={menu} />;
  if (menu.type === 'figureAlt') return <AltEditor app={app} menu={menu} />;
  if (menu.type === 'callout') return <CalloutPicker app={app} menu={menu} />;
  if (menu.type === 'pasteUrl') return <PasteUrlOffer app={app} menu={menu} />;
  if (menu.type === 'field') return <FieldPopover key={menu.field} app={app} menu={menu} />;
  return null;
}

export function EditorUI({ app }) {
  const st = useStore(app.store);
  const ed = app.editor;
  if (!st.loaded || !ed || ed.isDestroyed) {
    return st.busy ? <div class="ui-toast"><span class="ui-spinner" style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: '8px' }} />{st.busy}</div> : null;
  }
  const codePos = !st.readOnly && ed.view.hasFocus() ? codeBlockPos(ed.state) : null;
  const hoverCode = !st.readOnly && st.hover && st.hover.type === 'codeBlock' ? st.hover.pos : null;
  const codeAt = codePos != null ? codePos : hoverCode;
  const showHandle = !st.readOnly && st.hover && !st.typing && !st.slash && !st.dragging && (!st.menu || st.menu.type === 'block');
  return (
    <>
      {showHandle && <BlockHandle app={app} hover={st.hover} menuOpen={!!st.menu} />}
      {!st.readOnly && !st.menu && <SelectionTools app={app} st={st} />}
      {codeAt != null && !st.menu && <CodeTools key={'code' + codeAt} app={app} pos={codeAt} />}
      {st.slash && <SlashMenu app={app} slash={st.slash} />}
      {st.menu && <MenuHost app={app} menu={st.menu} />}
      {st.embedPrompt && <EmbedPrompt app={app} prompt={st.embedPrompt} />}
      {st.find && <FindBar app={app} find={st.find} />}
      {!st.readOnly && <HeaderAddRow app={app} st={st} />}
      <FigureBadges app={app} />
      {st.busy && <div class="ui-toast"><span class="ui-spinner" style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: '8px' }} />{st.busy}</div>}
    </>
  );
}
