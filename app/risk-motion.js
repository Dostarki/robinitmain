(() => {
  const style = document.createElement("style");
  style.textContent = '.risk-app{background:#070914!important;overflow:hidden}.risk-app:before,.risk-app:after{width:24vw!important;height:24vw!important;opacity:.11!important;filter:blur(34px)!important;transform:perspective(800px) rotateX(52deg) rotateZ(18deg)!important;animation:orbitalDrift 17s cubic-bezier(.42,0,.3,1) infinite!important}.risk-app:before{background:conic-gradient(from 40deg,#7f6cff,transparent 35%,#41ceff,transparent 72%)!important;top:-8vw!important;right:9vw!important}.risk-app:after{background:conic-gradient(from 160deg,#5c79ff,transparent 34%,#70e1d3,transparent 71%)!important;bottom:-12vw!important;left:16vw!important;animation-delay:-8s!important}@keyframes orbitalDrift{0%,100%{transform:perspective(800px) rotateX(52deg) rotateZ(18deg) translate3d(0,0,0)}50%{transform:perspective(800px) rotateX(64deg) rotateZ(-12deg) translate3d(5vw,-3vw,80px)}}.risk-app main:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.16;background-image:linear-gradient(#8697ff11 1px,transparent 1px),linear-gradient(90deg,#8697ff11 1px,transparent 1px);background-size:52px 52px;mask-image:radial-gradient(ellipse at center,black,transparent 72%)}.card.reveal .scoreline,.card.reveal li,.card.reveal small{opacity:0;transform:translateY(12px);filter:blur(4px);animation:reportReveal .48s cubic-bezier(.16,1,.3,1) forwards}.card.reveal .scoreline{animation-delay:.1s}.card.reveal li:nth-child(1){animation-delay:.22s}.card.reveal li:nth-child(2){animation-delay:.34s}.card.reveal li:nth-child(3){animation-delay:.46s}.card.reveal li:nth-child(4){animation-delay:.58s}.card.reveal li:nth-child(5){animation-delay:.7s}.card.reveal li:nth-child(6){animation-delay:.82s}.card.reveal li:nth-child(7){animation-delay:.94s}.card.reveal small{animation-delay:1.06s}@keyframes reportReveal{to{opacity:1;transform:translateY(0);filter:blur(0)}}';
  document.head.append(style);
  function titleFromCard(card) {
    const meta = card.querySelector("small")?.textContent || "";
    const title = meta.split(" · ").slice(0,2).join(" · ");
    if (!title) return;
    const active = document.querySelector(".chat.active .pick");
    const previousTitle = active?.textContent;
    if (active) active.textContent = title;
    try {
      const key = "test-risk-chats-v1", chats = JSON.parse(localStorage.getItem(key) || "[]");
      const matching = chats.find(item => item.title === previousTitle) || chats.find(item => item.title === "New analysis");
      if (matching) { matching.title = title; localStorage.setItem(key, JSON.stringify(chats)); }
    } catch {}
  }
  const observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (!(node instanceof HTMLElement)) return;
    const card = node.matches?.(".card") ? node : node.querySelector?.(".card");
    if (!card || card.dataset.revealed) return;
    card.dataset.revealed = "1"; card.classList.add("reveal"); titleFromCard(card);
  })));
  const thread = document.getElementById("thread");
  if (thread) observer.observe(thread, { childList:true, subtree:true });
})();
