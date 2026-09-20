(() => {
  window.level = value => value === "low" ? "High safety" : value === "moderate" ? "Moderate safety" : value === "high" ? "Low safety" : "Critical risk";
  const originalDraw = window.draw;
  if (typeof originalDraw !== "function") return;

  const notes = {
    "Honeypot signal": "The primary provider flags potential sell restriction behavior.",
    "Swap simulation flagged honeypot": "An independent swap simulation indicates a potential honeypot.",
    "Mint authority enabled": "A privileged authority may be able to increase token supply.",
    "Freeze authority enabled": "A privileged authority may be able to freeze balances or transfers.",
    "Blacklist capability": "The contract exposes blacklist-related controls.",
    "Hidden owner": "The contract may retain undisclosed privileged ownership.",
    "Upgradeable proxy": "The contract logic may be changed after deployment.",
    "Transfers can be paused": "A privileged authority may pause transfers.",
    "Source code not verified": "The provider does not report verified source code.",
    "High buy tax": "The reported buy tax exceeds the review threshold.",
    "High sell tax": "The reported sell tax exceeds the review threshold.",
    "Balance authority enabled": "A privileged authority may alter token-account balances.",
    "Closable token accounts": "A privileged authority may close token accounts.",
    "Restricted default account state": "New token accounts may begin in a restricted state.",
    "Default account state upgradeable": "The default account policy can be changed.",
    "Transfer fee enabled": "Transfers may include a token-level fee.",
    "Transfer fee upgradeable": "A privileged authority may change token fees.",
    "Transfer hook enabled": "Transfers invoke supplementary program logic.",
    "Transfer hook upgradeable": "Supplementary transfer logic can be changed.",
    "Non-transferable token": "The token cannot be freely transferred.",
    "Independent high-risk signal": "The independent Solana validation source returned a high-risk signal."
  };

  function renderBreakdown(report) {
    const reportEl = document.getElementById("report");
    let section = document.getElementById("risk-breakdown");
    if (!section) {
      section = document.createElement("section");
      section.id = "risk-breakdown";
      reportEl.insertBefore(section, document.getElementById("details"));
    }
    section.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Risk breakdown";
    const intro = document.createElement("p");
    intro.className = "meta";
    intro.textContent = "The score starts at 100. Each warning subtracts its listed points; clear checks do not reduce it.";
    const grid = document.createElement("div");
    grid.className = "risk-breakdown-grid";
    const criteria = report.criteria || (report.signals || []).map(item => ({ title: item.title, note: notes[item.title] || "A risk signal was returned by a connected provider.", status: "warning", points: item.weight }));
    criteria.forEach(item => {
      const card = document.createElement("article");
      card.className = "risk-breakdown-item " + (item.status === "warning" ? "is-warning" : "is-clear");
      const header = document.createElement("div");
      header.className = "risk-breakdown-head";
      const title = document.createElement("strong");
      title.textContent = item.title;
      const points = document.createElement("span");
      points.textContent = item.status === "warning" ? "Warning · −" + item.points : "Clear · −0";
      const note = document.createElement("small");
      note.textContent = item.note || notes[item.title] || "No matching risk signal was returned for this check.";
      header.append(title, points);
      card.append(header, note);
      grid.append(card);
    });
    section.append(heading, intro, grid);
  }

  const style = document.createElement("style");
  style.textContent = ".risk-breakdown-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:14px 0}.risk-breakdown-item{border:1px solid #27513c;border-radius:12px;padding:13px;background:#0c1118}.risk-breakdown-item.is-warning{border-color:#6e4350}.risk-breakdown-head{display:flex;justify-content:space-between;gap:10px}.risk-breakdown-item small{display:block;color:#95a6b9;margin-top:7px}.is-warning .risk-breakdown-head span{color:#ff737d}.is-clear .risk-breakdown-head span{color:#55d98a}@media(max-width:720px){.risk-breakdown-grid{grid-template-columns:1fr}}";
  document.head.append(style);
  window.draw = report => { originalDraw(report); renderBreakdown(report); };
})();
const chatScript = document.createElement("script");
chatScript.src = "/risk-chat.js";
document.body.append(chatScript);
