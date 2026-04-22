// ShopVOX browser-console extractor — paste into DevTools console.
//
// Two navigation modes, tried in order:
//   1. SPA auto-advance (pushState + popstate dispatch) — single paste
//      walks every product with no re-paste required.
//   2. Full-reload fallback — if SPA nav doesn't take effect within 10s,
//      script falls back to window.location.href and relies on
//      sessionStorage to resume. User must paste again after each reload
//      (or install the bookmarklet at the bottom of this file).
//
// USAGE
//   1. Go to https://express.shopvox.com/settings/products
//   2. Click "Load All" so every row is rendered
//   3. Open DevTools → Console → paste this file → Enter
//   4. Watch the log — either it completes on its own (SPA mode) or it
//      prints "paste script again" after each fallback navigation.
//
// ABORT: sessionStorage.removeItem('svExtract') and reload.

(async function () {
  const DELAY = (ms) => new Promise((r) => setTimeout(r, ms))
  const KEY = 'svExtract'

  // ── Utilities ───────────────────────────────────────────────────────

  const findByExactText = (text) =>
    Array.from(document.querySelectorAll('*')).find(
      (e) => e.innerText?.trim() === text && e.children.length < 5,
    )

  function downloadJson(results) {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `shopvox-extract-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
  }

  // Wait up to `timeoutMs` for the detail page to render.
  async function waitForDetailLoaded(timeoutMs = 15000) {
    const poll = Math.ceil(timeoutMs / 500)
    for (let t = 0; t < poll; t++) {
      if (
        document.title !== 'shopVOX' &&
        document.querySelector('#product-detail-config')?.children.length > 0
      ) {
        return true
      }
      await DELAY(500)
    }
    return false
  }

  // SPA navigation: pushState + popstate event. Most React/Vite routers
  // (ShopVOX uses react-router) listen to popstate and re-render. Returns
  // true if the URL AND title changed within `timeoutMs`, false otherwise.
  async function navigateSpa(nextUrl, timeoutMs = 10000) {
    const startHref = window.location.href
    const startTitle = document.title
    try {
      history.pushState(null, '', nextUrl)
      window.dispatchEvent(new PopStateEvent('popstate'))
    } catch (e) {
      console.warn('  pushState threw:', e.message)
      return false
    }

    // Wait for URL to settle.
    const poll = Math.ceil(timeoutMs / 500)
    for (let t = 0; t < poll; t++) {
      await DELAY(500)
      if (window.location.href !== startHref) break
      if (t === poll - 1) return false // URL never changed
    }

    // Wait for title/content to reflect the new product.
    for (let t = 0; t < 30; t++) {
      if (document.title !== startTitle && (await waitForDetailLoaded(500))) return true
      await DELAY(500)
    }
    return false
  }

  // Extract a single product's data from the currently-loaded detail page.
  async function extractCurrentProduct(url) {
    await waitForDetailLoaded(15000)

    const sectionNames = ['Modifiers', 'Dropdown Menus', 'Default Items', 'Product Template']
    for (const name of sectionNames) {
      const el = findByExactText(name)
      if (el) {
        el.scrollIntoView({ block: 'center' })
        el.click()
      }
      await DELAY(400)
    }
    await DELAY(1500)

    const rows = Array.from(document.querySelectorAll('div[aria-roledescription="sortable"]'))
    // Build headers then sort by DOM order. sectionNames order is arbitrary;
    // the `next` boundary in the loop below assumes headers[i+1] is the
    // physically-next header on the page. If we don't sort, a section
    // whose next-in-array header is earlier in the DOM will lose all its
    // rows (see: Default Items when Product Template follows in the array).
    const headers = sectionNames
      .map((name) => ({ name, el: findByExactText(name) }))
      .filter((x) => x.el)
      .sort((a, b) => {
        const pos = a.el.compareDocumentPosition(b.el)
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1
        return 0
      })

    const sectionData = {}
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i]
      const next = headers[i + 1]
      const sectionRows = rows.filter((row) => {
        const after =
          header.el.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING
        const before =
          !next ||
          !(next.el.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)
        return after && before
      })
      sectionData[header.name] = sectionRows
        .map((r) => r.innerText?.trim().split('\n').map((t) => t.trim()).filter(Boolean))
        .filter((c) => c && c.length > 0)
    }

    return {
      url,
      shopvoxId: url.split('/').pop(),
      name: document.title.replace(' ‒ shopVOX', ''),
      modifiers: (sectionData['Modifiers'] || []).map((cells) => ({
        name: cells[0], type: cells[1], default: cells[2], in_use: cells[3],
      })),
      dropdown_menus: (sectionData['Dropdown Menus'] || []).map((cells) => ({
        menu_name: cells[0], item_type: cells[1], category: cells[2], reference: cells[3],
      })),
      default_items: (sectionData['Default Items'] || []).map((cells) => ({
        name: cells[0], item_type: cells[1],
      })),
    }
  }

  // ── Main ────────────────────────────────────────────────────────────

  let state = JSON.parse(sessionStorage.getItem(KEY) || 'null')

  // STATE A — fresh start (no session): collect URLs from the list page.
  if (!state) {
    const links = Array.from(document.querySelectorAll('a[href^="/settings/products/"]'))
    const urls = [...new Set(links.map((l) => l.href))].filter((u) =>
      u.match(/\/settings\/products\/[0-9a-f-]{36}$/),
    )
    if (urls.length === 0) {
      console.error('✗ No product URLs found. Are you on /settings/products with "Load All" clicked?')
      return
    }
    state = { urls, index: 0, results: [] }
    sessionStorage.setItem(KEY, JSON.stringify(state))
    console.log(
      `%c▶ Queued ${urls.length} products.`,
      'color: #0a7; font-weight: bold; font-size: 13px',
    )
  }

  // STATE B — mid-run: try SPA auto-advance loop. Each iteration:
  //   pushState → popstate → wait for content → extract → save → next.
  console.log('%c▶ Attempting SPA auto-advance extraction…', 'color: #06c; font-weight: bold')

  while (state.index < state.urls.length) {
    const url = state.urls[state.index]
    console.log(
      `%c[${state.index + 1}/${state.urls.length}]`,
      'color: #888', `→ ${url}`,
    )

    // If we're already on the target (e.g. after a fallback reload), skip nav.
    let landedOk = window.location.href.startsWith(url)
    if (!landedOk) {
      landedOk = await navigateSpa(url, 10000)
    } else {
      // Ensure the page has content before we extract.
      landedOk = await waitForDetailLoaded(15000)
    }

    if (!landedOk) {
      // SPA nav didn't take — fall back to full reload. sessionStorage
      // persists, so the next paste (or bookmarklet click) resumes here.
      console.warn(
        '  SPA nav failed after 10s — falling back to window.location.href. ' +
        'Paste the script again on the next page (or use the bookmarklet).',
      )
      window.location.href = url
      return
    }

    let product
    try {
      product = await extractCurrentProduct(url)
      console.log(
        `  ✓ "${product.name}"`,
        `| modifiers=${product.modifiers.length}`,
        `dropdowns=${product.dropdown_menus.length}`,
        `default_items=${product.default_items.length}`,
      )
    } catch (e) {
      console.error(`  ✗ extraction failed: ${e.message}`)
      product = { url, shopvoxId: url.split('/').pop(), error: e.message }
    }

    state.results.push(product)
    state.index++
    sessionStorage.setItem(KEY, JSON.stringify(state))
  }

  console.log(
    `%c✓ All ${state.results.length} products extracted — downloading JSON.`,
    'color: #0a7; font-weight: bold; font-size: 14px',
  )
  downloadJson(state.results)
  sessionStorage.removeItem(KEY)
})()

// ═══════════════════════════════════════════════════════════════════════
// BOOKMARKLET VERSION — one-click per page (no re-pasting)
// ═══════════════════════════════════════════════════════════════════════
//
// Save the script as a Chrome bookmark so you can invoke it from the
// bookmarks bar. Works perfectly with the SPA auto-advance path, and
// provides a one-click retry if the fallback reload path triggers.
//
// HOW TO INSTALL
//   1. Open chrome://bookmarks
//   2. Click "Add new bookmark" → Name: "ShopVOX Extract"
//   3. For URL, paste the entire line below (beginning with `javascript:`)
//      as a single line — make sure it stays one line, no newlines:
//
// javascript:(async function(){const DELAY=(ms)=>new Promise((r)=>setTimeout(r,ms));const KEY='svExtract';const findByExactText=(text)=>Array.from(document.querySelectorAll('*')).find((e)=>e.innerText?.trim()===text&&e.children.length<5);function downloadJson(results){const blob=new Blob([JSON.stringify(results,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`shopvox-extract-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(a.href)}async function waitForDetailLoaded(timeoutMs=15000){const poll=Math.ceil(timeoutMs/500);for(let t=0;t<poll;t++){if(document.title!=='shopVOX'&&document.querySelector('#product-detail-config')?.children.length>0)return true;await DELAY(500)}return false}async function navigateSpa(nextUrl,timeoutMs=10000){const startHref=window.location.href;const startTitle=document.title;try{history.pushState(null,'',nextUrl);window.dispatchEvent(new PopStateEvent('popstate'))}catch(e){return false}const poll=Math.ceil(timeoutMs/500);for(let t=0;t<poll;t++){await DELAY(500);if(window.location.href!==startHref)break;if(t===poll-1)return false}for(let t=0;t<30;t++){if(document.title!==startTitle&&await waitForDetailLoaded(500))return true;await DELAY(500)}return false}async function extractCurrentProduct(url){await waitForDetailLoaded(15000);const sectionNames=['Modifiers','Dropdown Menus','Default Items','Product Template'];for(const name of sectionNames){const el=findByExactText(name);if(el){el.scrollIntoView({block:'center'});el.click()}await DELAY(400)}await DELAY(1500);const rows=Array.from(document.querySelectorAll('div[aria-roledescription="sortable"]'));const headers=sectionNames.map((name)=>({name,el:findByExactText(name)})).filter((x)=>x.el).sort((a,b)=>{const p=a.el.compareDocumentPosition(b.el);if(p&Node.DOCUMENT_POSITION_FOLLOWING)return -1;if(p&Node.DOCUMENT_POSITION_PRECEDING)return 1;return 0;});const sectionData={};for(let i=0;i<headers.length;i++){const header=headers[i];const next=headers[i+1];const sectionRows=rows.filter((row)=>{const after=header.el.compareDocumentPosition(row)&Node.DOCUMENT_POSITION_FOLLOWING;const before=!next||!(next.el.compareDocumentPosition(row)&Node.DOCUMENT_POSITION_FOLLOWING);return after&&before});sectionData[header.name]=sectionRows.map((r)=>r.innerText?.trim().split('\n').map((t)=>t.trim()).filter(Boolean)).filter((c)=>c&&c.length>0)}return{url,shopvoxId:url.split('/').pop(),name:document.title.replace(' ‒ shopVOX',''),modifiers:(sectionData['Modifiers']||[]).map((c)=>({name:c[0],type:c[1],default:c[2],in_use:c[3]})),dropdown_menus:(sectionData['Dropdown Menus']||[]).map((c)=>({menu_name:c[0],item_type:c[1],category:c[2],reference:c[3]})),default_items:(sectionData['Default Items']||[]).map((c)=>({name:c[0],item_type:c[1]}))}}let state=JSON.parse(sessionStorage.getItem(KEY)||'null');if(!state){const links=Array.from(document.querySelectorAll('a[href^="/settings/products/"]'));const urls=[...new Set(links.map((l)=>l.href))].filter((u)=>u.match(/\/settings\/products\/[0-9a-f-]{36}$/));if(urls.length===0){console.error('No product URLs found');return}state={urls,index:0,results:[]};sessionStorage.setItem(KEY,JSON.stringify(state));console.log(`Queued ${urls.length} products`)}while(state.index<state.urls.length){const url=state.urls[state.index];console.log(`[${state.index+1}/${state.urls.length}] ${url}`);let ok=window.location.href.startsWith(url);if(!ok)ok=await navigateSpa(url,10000);else ok=await waitForDetailLoaded(15000);if(!ok){console.warn('SPA nav failed — full reload fallback; click bookmarklet again on next page');window.location.href=url;return}let product;try{product=await extractCurrentProduct(url);console.log(`  ✓ "${product.name}" mods=${product.modifiers.length} dd=${product.dropdown_menus.length} di=${product.default_items.length}`)}catch(e){product={url,shopvoxId:url.split('/').pop(),error:e.message}}state.results.push(product);state.index++;sessionStorage.setItem(KEY,JSON.stringify(state))}console.log(`All ${state.results.length} done — downloading`);downloadJson(state.results);sessionStorage.removeItem(KEY)})()
//
//   4. Save. Use the bookmark on the list page to start, then click it
//      again if the SPA path bails to a full reload.
//
// ═══════════════════════════════════════════════════════════════════════
