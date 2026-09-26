import { esc, layoutStyle, normLayout, safeFocus, safeUrl } from './util.js';

export const SITE_NAME = '_DEV.LOG';
export const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Noto+Sans+SC:wght@300;400;700&family=Fira+Code:wght@400;500&display=swap';
export const GENERATOR = 'devlog-admin 2';

export const PATHS = {
  post: p => `blog/${p.slug}.html`,
  work: w => `works/${w.slug}.html`,
  galleryItem: (item, cat) => `gallery/${cat.slug}/${item.slug}.html`,
  about: () => 'about/index.html',
  blogIndex: 'blog/index.html',
  worksIndex: 'works/index.html',
  galleryIndex: 'gallery/index.html',
  category: cat => `gallery/${cat.slug}/index.html`,
};

export function pageUrl(path) {
  return '/' + path.replace(/index\.html$/, '');
}

const NAV = `<nav>
  <div class="nav-logo">_<span>DEV</span>.LOG</div>
  <div class="nav-links">
    <a href="/">首页</a>
    <a href="/blog/">博客</a>
    <a href="/works/">项目</a>
    <a href="/gallery/">创作</a>
    <a href="/about/">关于</a>
  </div>
</nav>`;

const PROTECT_SCRIPT = `<script>
(function(){
  document.addEventListener('contextmenu',function(e){e.preventDefault();});
  document.addEventListener('dragstart',function(e){if(e.target.tagName==='IMG')e.preventDefault();});
  document.addEventListener('keydown',function(e){
    if(!e.key)return;
    if((e.ctrlKey||e.metaKey)&&(e.key==='s'||e.key==='S'||e.key==='p'||e.key==='P'))e.preventDefault();
    if(e.key==='PrintScreen')e.preventDefault();
  });
})();
</script>`;

function head({ title, description = '', image = '', css, extraHead = '' }) {
  return `<!DOCTYPE html>
<html lang="zh"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="generator" content="${GENERATOR}">
${description ? `<meta name="description" content="${esc(description)}">\n<meta property="og:description" content="${esc(description)}">\n` : ''}<meta property="og:title" content="${esc(title)}">
${image ? `<meta property="og:image" content="${esc(image)}">\n` : ''}<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS_HREF}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${FONTS_HREF}"></noscript>
<style>
${css}
</style>
${extraHead}</head>`;
}

function editAttrs(mode, field, extra = '') {
  return mode === 'edit' ? ` data-field="${field}"${extra}` : '';
}

function titleAttrs(mode) {
  return mode === 'edit' ? ' data-field="title" contenteditable="plaintext-only" spellcheck="false" data-placeholder="请输入标题"' : '';
}

function zone(mode, name, html) {
  return mode === 'edit' ? `<div data-zone="${name}" style="display:contents">${html}</div>` : html;
}

function bodyContainer(mode, cls, html) {
  return mode === 'edit'
    ? `<div class="doc ${cls}" data-mount="body"></div>`
    : `<div class="doc ${cls}">${html}</div>`;
}

function tail(mode, scripts = '') {
  if (mode === 'edit') return `<div id="ui-root"></div>\n</body></html>`;
  return `${PROTECT_SCRIPT}\n${scripts}</body></html>`;
}

/* ---------------- post ---------------- */

export function postHeaderHTML(p, mode) {
  const tags = (p.tags || []).map(t => `<span${editAttrs(mode, 'tags')}>${esc(t)}</span>`).join('');
  return `<div class="post-header">
    <span class="post-cat"${editAttrs(mode, 'cat')}># ${esc(p.cat || '未分类')}</span>
    <h1 class="post-title"${titleAttrs(mode)}>${esc(p.title || '')}</h1>
    <div class="post-meta"${editAttrs(mode, 'meta')}><span${editAttrs(mode, 'date')}>${esc(p.date || '')}</span>${tags}</div>
  </div>`;
}

export function postCoverHTML(p, mode) {
  if (!p.cover) return '';
  const pos = safeFocus(p.coverPos);
  return `<img class="post-cover" src="${esc(p.cover)}" alt="封面" decoding="async" fetchpriority="high"${pos !== '50% 50%' ? ` style="object-position:${pos}"` : ''}${editAttrs(mode, 'cover')}>`;
}

export function renderPostPage(p, bodyHTML, { css, mode = 'publish', editHead = '', description = '' }) {
  const layout = normLayout(p.layout, 'post');
  return `${head({ title: `${p.title || '无标题'} · ${SITE_NAME}`, description, image: p.cover, css, extraHead: editHead })}
<body class="page-post${mode === 'edit' ? ' is-editing' : ''}">
${NAV}
<div class="page-wrap" style="${layoutStyle(layout)}">
  <div class="nav-btns">
    <a class="back-btn" href="/">← 首页</a>
    <a class="back-btn" href="/blog/">← 返回博客</a>
  </div>
  ${zone(mode, 'header', postHeaderHTML(p, mode))}
  ${zone(mode, 'cover', postCoverHTML(p, mode))}
  ${bodyContainer(mode, 'post-body', bodyHTML)}
</div>
${tail(mode)}`;
}

/* ---------------- work ---------------- */

const COVER_SWAP_SCRIPT = `<script>
(function(){
  var cover=document.querySelector('.wd-cover[data-full-src]');
  if(!cover)return;
  var full=cover.getAttribute('data-full-src'),thumb=cover.getAttribute('src');
  if(!full||full===thumb)return;
  var swap=function(){var img=new Image();img.decoding='async';img.onload=function(){cover.src=full;};img.src=full;};
  if('requestIdleCallback' in window)requestIdleCallback(swap,{timeout:1500});else setTimeout(swap,300);
})();
</script>`;

const PLAY_SCRIPT = `<script>
(function(){
  var shell=document.querySelector('.play-shell');
  if(!shell)return;
  var btn=shell.querySelector('.play-launch');
  if(!btn)return;
  btn.addEventListener('click',function(){
    if(shell.querySelector('.play-frame'))return;
    var src=shell.getAttribute('data-src');
    var frame=document.createElement('iframe');
    frame.className='play-frame';
    frame.src=src;
    frame.title='在线游玩';
    frame.setAttribute('allow','autoplay; fullscreen; gamepad; pointer-lock');
    frame.setAttribute('allowfullscreen','');
    shell.classList.add('is-playing');
    shell.appendChild(frame);
    var bar=document.createElement('div');
    bar.className='play-bar';
    var fs=document.createElement('button');fs.type='button';fs.textContent='全屏';
    var open=document.createElement('a');open.href=src;open.target='_blank';open.rel='noopener';open.textContent='新标签';
    bar.appendChild(fs);bar.appendChild(open);
    shell.appendChild(bar);
    fs.addEventListener('click',function(){
      if(document.fullscreenElement)document.exitFullscreen();
      else if(shell.requestFullscreen)shell.requestFullscreen();
    });
    frame.addEventListener('load',function(){try{frame.focus();}catch(e){}});
  });
})();
</script>`;

export function workHeaderHTML(w, mode) {
  const tags = (w.tags || []).map(t => `<span class="wd-tag-item">${esc(t)}</span>`).join('');
  return `<div class="wd-header">
    <span class="wd-tag">// WORKS</span>
    <h1 class="wd-title"${titleAttrs(mode)}>${esc(w.title || '')}</h1>
    <div class="wd-tags"${editAttrs(mode, 'tags')}>${tags}</div>
  </div>`;
}

export function workMediaHTML(w, mode) {
  const thumb = w.cover || '';
  const full = w.coverFull || w.cover || '';
  const pos = safeFocus(w.coverPos);
  const play = safeUrl(w.play);
  if (!play) {
    return thumb
      ? `<img class="wd-cover" src="${esc(thumb)}" data-full-src="${esc(full)}" style="object-position:${pos}" alt="" decoding="async" fetchpriority="high"${editAttrs(mode, 'cover')}>`
      : '';
  }
  const poster = thumb
    ? `<img class="wd-cover play-poster" src="${esc(thumb)}" data-full-src="${esc(full)}" style="object-position:${pos}" alt="" decoding="async">`
    : '<div class="play-poster play-poster-empty"></div>';
  return `<div class="play-shell" data-src="${esc(play)}"${editAttrs(mode, 'play')}>
    ${poster}
    <button type="button" class="play-launch"${mode === 'edit' ? ' tabindex="-1"' : ''}>▶ 开始游戏</button>
    <div class="play-hint">浏览器内直接游玩 · 点按后开始加载</div>
  </div>`;
}

export function workLinkHTML(w, mode) {
  const link = safeUrl(w.link);
  if (!link) return '';
  return `<div class="wd-link-wrap"><a class="wd-link" href="${esc(link)}" target="_blank" rel="noopener"${editAttrs(mode, 'link')}>查看项目 →</a></div>`;
}

export function renderWorkPage(w, bodyHTML, { css, mode = 'publish', editHead = '', description = '' }) {
  const layout = normLayout(w.layout, 'work');
  const scripts = `${COVER_SWAP_SCRIPT}\n${safeUrl(w.play) ? PLAY_SCRIPT + '\n' : ''}`;
  return `${head({ title: `${w.title || '无标题'} · 游戏开发 · ${SITE_NAME}`, description: w.desc || description, image: w.cover, css, extraHead: editHead })}
<body class="page-work${mode === 'edit' ? ' is-editing' : ''}">
${NAV}
<div class="page-wrap" style="${layoutStyle(layout)}">
  <div class="nav-btns">
    <a class="back-btn" href="/">← 首页</a>
    <a class="back-btn" href="/works/">← 返回项目</a>
  </div>
  ${zone(mode, 'header', workHeaderHTML(w, mode))}
  ${zone(mode, 'media', workMediaHTML(w, mode))}
  ${bodyContainer(mode, 'wd-body', bodyHTML)}
  ${zone(mode, 'link', workLinkHTML(w, mode))}
</div>
${tail(mode, scripts)}`;
}

/* ---------------- gallery item ---------------- */

export function galleryCanvasScript(thumb, full, protect) {
  return `<script>
(function(){
  var THUMB=${JSON.stringify(thumb)},FULL=${JSON.stringify(full)},W="Xcale";
  var cv=document.getElementById("gd-c");if(!cv)return;
  var cx=cv.getContext("2d");
  function drawWM(ctx,w,h){
    ctx.save();
    var fs=Math.max(18,Math.min(w,h)*0.045);
    ctx.font="bold "+fs+"px Share Tech Mono,monospace";
    ctx.fillStyle="rgba(255,0,110,0.75)";ctx.strokeStyle="rgba(0,0,0,0.4)";ctx.lineWidth=1;
    ctx.rotate(-Math.PI/6);
    var sx=w*0.26,sy=Math.max(fs*2.2,h*0.12);
    for(var y=-h*1.5;y<w+h*1.5;y+=sy)
      for(var x=-w*1.5;x<w+h*1.5;x+=sx){ctx.strokeText(W,x,y);ctx.fillText(W,x,y);}
    ctx.restore();
  }
  var current=null;
  function renderImg(img){
    current=img;
    var dpr=window.devicePixelRatio||1;
    var maxW=window.innerWidth*0.8,maxH=window.innerHeight*0.85;
    var sc=Math.min(1,maxW/img.naturalWidth,maxH/img.naturalHeight);
    var cssW=img.naturalWidth*sc,cssH=img.naturalHeight*sc;
    cv.width=cssW*dpr;cv.height=cssH*dpr;
    cv.style.width=cssW+"px";cv.style.height=cssH+"px";
    cx.setTransform(dpr,0,0,dpr,0,0);
    cx.clearRect(0,0,cssW,cssH);
    cx.drawImage(img,0,0,cssW,cssH);
    var wc=document.createElement("canvas");wc.width=cv.width;wc.height=cv.height;
    var wx=wc.getContext("2d");wx.setTransform(dpr,0,0,dpr,0,0);wx.drawImage(img,0,0,cssW,cssH);drawWM(wx,cssW,cssH);
    cv.toDataURL=function(){return wc.toDataURL.apply(wc,arguments);};
    cv.toBlob=function(cb,t,q){return wc.toBlob(cb,t,q);};
  }
  var thumbImg=new Image();thumbImg.crossOrigin="anonymous";
  thumbImg.onload=function(){if(current===null||current===thumbImg)renderImg(thumbImg);};
  thumbImg.src=THUMB;
  if(FULL&&FULL!==THUMB){
    var fullImg=new Image();fullImg.crossOrigin="anonymous";
    fullImg.onload=function(){renderImg(fullImg);};
    fullImg.src=FULL;
  }
  window.addEventListener("resize",function(){if(current)renderImg(current);});${protect ? `
  cv.addEventListener("dragstart",function(e){e.preventDefault();});
  cv.addEventListener("touchstart",function(e){e.preventDefault();},{passive:false});` : ''}
})();
</script>`;
}

export function galleryHeaderHTML(cat, item, mode) {
  return `<span class="gd-cat"${editAttrs(mode, 'category')}>// ${esc((cat.name || '').toUpperCase())}</span>
  <h1 class="gd-title"${titleAttrs(mode)}>${esc(item.title || '')}</h1>`;
}

export function galleryMediaHTML(item, mode) {
  const full = item.imgFull || item.img || '';
  if (!full) return '';
  return `<canvas id="gd-c" class="gd-canvas"${editAttrs(mode, 'image')}></canvas>`;
}

export function renderGalleryItemPage(cat, item, bodyHTML, { css, mode = 'publish', editHead = '', description = '' }) {
  const layout = normLayout(item.layout, 'galleryItem');
  const thumb = item.img || '';
  const full = item.imgFull || item.img || '';
  const canvasScript = full ? galleryCanvasScript(thumb || full, full, mode !== 'edit') : '';
  return `${head({ title: `${item.title || '无标题'} · ${cat.name} · ${SITE_NAME}`, description: item.desc || description, image: thumb, css, extraHead: editHead })}
<body class="page-gallery-item${mode === 'edit' ? ' is-editing' : ''}">
${NAV}
<div class="page-wrap" style="${layoutStyle(layout)}">
  <div class="nav-btns">
    <a class="back-btn" href="/">← 首页</a>
    <a class="back-btn" href="/gallery/">← 画廊</a>
    <a class="back-btn" href="/gallery/${esc(cat.slug)}/">← 返回${esc(cat.name)}</a>
  </div>
  ${zone(mode, 'header', galleryHeaderHTML(cat, item, mode))}
  ${zone(mode, 'media', galleryMediaHTML(item, mode))}
  ${bodyContainer(mode, 'gd-body', bodyHTML)}
</div>
${mode === 'edit' ? canvasScript + '\n' : ''}${tail(mode, canvasScript + '\n')}`;
}

/* ---------------- about ---------------- */

export function renderAboutPage(about, bodyHTML, { css, mode = 'publish', editHead = '', description = '' }) {
  const layout = normLayout(about.layout, 'about');
  return `${head({ title: `${about.title || '关于我'} · ${SITE_NAME}`, description, css, extraHead: editHead })}
<body class="page-about${mode === 'edit' ? ' is-editing' : ''}">
${NAV}
<div class="page-wrap" style="${layoutStyle(layout)}">
  ${bodyContainer(mode, 'about-body', bodyHTML)}
</div>
${tail(mode)}`;
}

/* ---------------- list pages ---------------- */

function listPage({ title, bodyClass = 'page-list', css, inner, scripts = '' }) {
  return `${head({ title, css })}
<body class="${bodyClass}">
${NAV}
<div class="page-wrap">
${inner}
</div>
${PROTECT_SCRIPT}
${scripts}</body></html>`;
}

const EMPTY = text => `<div class="list-empty">// ${text}</div>`;

export function blogCardHTML(p) {
  const tags = (p.tags || []).map(t => `<span>${esc(t)}</span>`).join(' ');
  return `
    <a class="blog-card" href="/${esc(PATHS.post(p))}">
      ${p.cover ? `<img class="bc-cover" src="${esc(p.cover)}"${safeFocus(p.coverPos) !== '50% 50%' ? ` style="object-position:${safeFocus(p.coverPos)}"` : ''} alt="" loading="lazy" decoding="async">` : '<div class="bc-cover-ph"></div>'}
      <div class="bc-body">
        <span class="bc-cat"># ${esc(p.cat || '未分类')}</span>
        <div class="bc-title">${esc(p.title || '')}</div>
        <div class="bc-meta">${esc(p.date || '')} ${tags}</div>
      </div>
    </a>`;
}

export function renderBlogIndex(posts, { css }) {
  return listPage({
    title: `博客 · ${SITE_NAME}`,
    css,
    inner: `  <div class="nav-btns">
    <a class="back-btn" href="/">← 首页</a>
  </div>
  <div class="page-title">// BLOG</div>
  <h1 class="page-heading">技术博客</h1>
  <div class="blog-grid">${posts.map(blogCardHTML).join('') || EMPTY('暂无已发布文章')}</div>`,
  });
}

export function workCardHTML(w) {
  return `
    <a class="work-card" href="/${esc(PATHS.work(w))}">
      ${w.cover ? `<img class="wc-img" src="${esc(w.cover)}" style="object-position:${safeFocus(w.coverPos)}" alt="" loading="lazy" decoding="async">` : '<div class="wc-img-ph"></div>'}
      <div class="wc-body">
        <div class="wc-title">${esc(w.title || '')}</div>
        <div class="wc-desc">${esc(w.desc || '')}</div>
        <div class="wc-tags">${(w.tags || []).map(t => `<span class="wc-tag">${esc(t)}</span>`).join('')}</div>
      </div>
    </a>`;
}

export function renderWorksIndex(works, { css }) {
  return listPage({
    title: `游戏项目 · ${SITE_NAME}`,
    css,
    inner: `  <div class="nav-btns">
    <a class="back-btn" href="/">← 首页</a>
  </div>
  <div class="page-title">// WORKS</div>
  <h1 class="page-heading">游戏开发</h1>
  <div class="works-grid">${works.map(workCardHTML).join('') || EMPTY('暂无项目')}</div>`,
  });
}

export function galleryCategoryCardHTML(cat) {
  const first = cat.items.find(i => i.img);
  return `
    <a class="gallery-card" href="/gallery/${esc(cat.slug)}/">
      ${first ? `<img class="gc-img" src="${esc(first.img)}" style="object-position:${safeFocus(first.imgPos)}" alt="" loading="lazy" decoding="async">` : '<div class="gc-img-ph" style="background:radial-gradient(circle at 50% 50%,rgba(255,0,110,.15),transparent)"></div>'}
      <div class="gc-body">
        <div class="gc-type">// ${cat.items.length} 件作品</div>
        <div class="gc-title">${esc(cat.name)}</div>
      </div>
    </a>`;
}

export function renderGalleryIndex(categories, { css }) {
  return listPage({
    title: `同人画廊 · ${SITE_NAME}`,
    css,
    inner: `  <div class="nav-btns">
    <a class="back-btn" href="/">← 首页</a>
  </div>
  <div class="page-title">// GALLERY</div>
  <h1 class="page-heading">同人创作</h1>
  <div class="gallery-grid">${categories.map(galleryCategoryCardHTML).join('') || EMPTY('暂无作品')}</div>`,
  });
}

export function galleryItemCardHTML(cat, item) {
  const full = item.imgFull && item.imgFull !== item.img ? ` data-full="${esc(item.imgFull)}"` : '';
  return `
    <a class="gallery-card" href="/${esc(PATHS.galleryItem(item, cat))}"${full}>
      ${item.img ? `<img class="gc-img" src="${esc(item.img)}" style="object-position:${safeFocus(item.imgPos)}" alt="" loading="lazy" decoding="async">` : '<div class="gc-img-ph"></div>'}
      <div class="gc-body">
        <div class="gc-type">// WORK</div>
        <div class="gc-title">${esc(item.title || '')}</div>
        ${item.desc ? `<div class="gc-desc">${esc(item.desc)}</div>` : ''}
      </div>
    </a>`;
}

const PRELOAD_SCRIPT = `<script>
(function(){
  var urls=[];
  document.querySelectorAll('.gallery-card[data-full]').forEach(function(card){if(card.dataset.full)urls.push(card.dataset.full);});
  if(!urls.length)return;
  var idx=0;
  function next(){
    if(idx>=urls.length)return;
    var img=new Image();
    img.onload=img.onerror=function(){idx++;if(idx<urls.length){if('requestIdleCallback' in window)requestIdleCallback(next,{timeout:2000});else setTimeout(next,200);}};
    img.src=urls[idx];
  }
  if('requestIdleCallback' in window)requestIdleCallback(next,{timeout:1000});else setTimeout(next,500);
})();
</script>
`;

export function renderCategoryPage(cat, { css }) {
  return listPage({
    title: `${cat.name} · 同人画廊 · ${SITE_NAME}`,
    css,
    inner: `  <div class="nav-btns">
    <a class="back-btn" href="/">← 首页</a>
    <a class="back-btn" href="/gallery/">← 返回画廊</a>
  </div>
  <div class="page-title">// GALLERY · ${esc((cat.name || '').toUpperCase())}</div>
  <h1 class="page-heading has-count">${esc(cat.name)}</h1>
  <div class="page-count">${cat.items.length} 件作品</div>
  <div class="gallery-grid">${cat.items.map(i => galleryItemCardHTML(cat, i)).join('') || EMPTY('暂无作品')}</div>`,
    scripts: PRELOAD_SCRIPT,
  });
}

export function renderRedirect(toPath) {
  const url = pageUrl(toPath);
  return `<!DOCTYPE html>
<html lang="zh"><head>
<meta charset="UTF-8">
<meta name="generator" content="${GENERATOR}">
<title>页面已移动</title>
<meta http-equiv="refresh" content="0; url=${esc(url)}">
<link rel="canonical" href="${esc(url)}">
<script>location.replace(${JSON.stringify(url)});</script>
</head><body style="background:#030810;color:#c8e0f0;font-family:sans-serif;padding:40px">
<p>页面已移动到 <a style="color:#00f5ff" href="${esc(url)}">${esc(url)}</a></p>
</body></html>`;
}
