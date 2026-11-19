/* Pulsus "Renew and pay" — the page each app serves at its own /renew.
 *
 * Copy pulsus-renew.js, pulsus-renew.css and renew.html into the app, and set
 * the data-* attributes on <body> in renew.html:
 *   data-product  the product key on Pulsus Platform (letters, tech, risk, …)
 *   data-name     the app's name ("Pulsus Communiqué")
 *   data-logo     the app's logo path on its own site
 *   data-signin   the app's own sign-in URL; "{next}" is replaced with this
 *                 page's address, so people come straight back here
 *   data-plans    the app's plans page (for people new to the app)
 *   data-home     where "Open <app>" goes (usually "/")
 *   data-api      Pulsus Platform's address (https://executive.pulsus.tech;
 *                 demo: https://demo-executive.pulsus.tech)
 *
 * Payment goes straight to Stripe for this app only, and Stripe sends the
 * person back to this page. No inline script: works under a strict CSP that
 * allows 'self' scripts and connect-src to data-api.
 */
(function () {
  var b = document.body, d = b.dataset;
  var API = (d.api || (/^demo-/.test(location.hostname) ? "https://demo-executive.pulsus.tech" : "https://executive.pulsus.tech")).replace(/\/+$/, "");
  var NAME = d.name || "this app", PRODUCT = d.product || "";
  var root = document.getElementById("rn-root");
  var here = location.origin + location.pathname;
  var paid = /[?&]paid=1\b/.test(location.search);

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function usd(c) { var v = c / 100; return "$" + v.toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }); }
  function day(ms) { return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }); }
  function signin() { return (d.signin || "/signin?next={next}").replace("{next}", encodeURIComponent(here)); }
  function foot() {
    return '<div class="rn-links"><a href="mailto:support@pulsus.tech?subject=' + encodeURIComponent(NAME + " renewal") + '">Questions? support@pulsus.tech</a>' +
      (d.plans ? '<a href="' + esc(d.plans) + '" target="_blank" rel="noopener">New to ' + esc(NAME) + '? See plans</a>' : "") + "</div>";
  }
  function card(pill, tone, title, lede, body) {
    root.innerHTML = '<section class="rn rn-' + tone + '">' + (pill ? '<span class="rn-pill">' + esc(pill) + "</span>" : "") +
      '<h1 class="rn-title">' + esc(title) + "</h1>" + (lede ? '<p class="rn-lede">' + lede + "</p>" : "") + body + foot() + "</section>";
  }
  function button(label, id) { return '<button type="button" class="rn-pay" id="' + id + '">' + esc(label) + "</button>"; }
  function link(label, href, ghost) { return '<a class="rn-pay' + (ghost ? " rn-ghost" : "") + '" href="' + esc(href) + '">' + esc(label) + "</a>"; }
  var SECURE = '<p class="rn-secure"><svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg>Secure card payment by Stripe. Billed monthly in US dollars.</p>';

  function start(btn) {
    btn.disabled = true; var was = btn.textContent; btn.textContent = "Opening secure checkout…";
    fetch(API + "/api/billing/renew", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product: PRODUCT, back: here }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok && j.url) { location.assign(j.url); return; }
        var msg = { owner_only: "Only an owner can pay.", billing_unavailable: "Online payment isn't available just now. Please write to support@pulsus.tech.", already_subscribed: "You're already subscribed.", enterprise_required: "This is above what self-service covers. Please write to support@pulsus.tech for a quotation.", signed_out: "Please sign in again." }[j && j.error] || "Couldn't open checkout. Please try again.";
        btn.disabled = false; btn.textContent = was; showError(msg);
      })
      .catch(function () { btn.disabled = false; btn.textContent = was; showError("Couldn't reach payment just now. Please try again."); });
  }
  function showError(t) { var e = document.getElementById("rn-err"); if (e) { e.textContent = t; e.hidden = false; } }

  function render(v) {
    if (!v || !v.ok) { card("", "bad", "Something went wrong", "We couldn't load your renewal. Please refresh the page.", ""); return; }
    if (!v.signedIn) {
      card("Renew", "bad", "Renew " + NAME, "Sign in with your company's owner account to see your plan and pay.", link("Sign in to renew", signin()));
      return;
    }
    if (!v.company) {
      card("", "warn", "Renew " + NAME, "This sign-in isn't linked to a customer company on Pulsus. Sign in with your company's owner account to pay, or start a free trial.",
        link("Sign in with your company account", signin()) + (d.plans ? link("Start a free trial", d.plans, true) : ""));
      return;
    }
    if (paid && v.action !== "active") {
      card("Payment received", "ok", "Thank you", "Your payment went through. We're switching " + esc(NAME) + " back on for <b>" + esc(v.company.name) + "</b>; this takes a few seconds.", link("Open " + NAME, d.home || "/"));
      setTimeout(load, 4000);
      return;
    }
    if (v.action === "active") {
      card(paid ? "Payment received" : "Active", "ok", paid ? "You're all set" : NAME + " is active", "<b>" + esc(v.company.name) + "</b>'s subscription is active. There's nothing to pay.", link("Open " + NAME, d.home || "/"));
      return;
    }
    if (v.action === "enterprise") {
      card("Enterprise", "warn", "Renew " + NAME, "<b>" + esc(v.company.name) + "</b> is on an Enterprise plan, billed by quotation.", link("Contact us to renew", "mailto:support@pulsus.tech?subject=" + encodeURIComponent("Enterprise renewal: " + NAME)));
      return;
    }
    if (v.action === "unavailable") {
      card("", "warn", "Renew " + NAME, "Online payment isn't available just now. Please write to support@pulsus.tech and we'll renew you straight away.", "");
      return;
    }
    var pill = { trial_ended: "Trial ended", cancelled: "Subscription ended", suspended: "Access paused", past_due: "Payment didn't go through", trial: "Free trial", not_held: "Add to your company", active: "" }[v.reason] || "";
    var tone = v.reason === "trial" || v.reason === "not_held" ? "warn" : "bad";
    if (v.action === "fix_card") {
      card(pill, "bad", "Update your payment details", "The last payment for <b>" + esc(v.company.name) + "</b> didn't go through. Update your card and your team is back in.",
        (v.isOwner ? button("Update payment details", "rn-go") + SECURE : '<div class="rn-ask">Only an owner can update the card.' + owners(v) + "</div>") + '<p class="rn-err" id="rn-err" hidden></p>');
      wire(); return;
    }
    var title = v.reason === "not_held" ? "Add " + NAME : v.reason === "trial" ? "Keep " + NAME : "Renew " + NAME;
    var lede = {
      trial_ended: "Your free trial ended" + (v.company.trialEndsAt ? " on " + day(v.company.trialEndsAt) : "") + ". Your records and settings are kept. Pay and your team is back in straight away.",
      trial: "Your free trial ends" + (v.company.trialEndsAt ? " on " + day(v.company.trialEndsAt) : " soon") + ". Subscribe now and nothing stops.",
      cancelled: "Your subscription has ended. Your records and settings are kept. Pay and your team is back in straight away.",
      suspended: "Access is paused. Your records and settings are kept. Pay and your team is back in straight away.",
      not_held: "Add " + esc(NAME) + " for your company.",
    }[v.reason] || "";
    var rows = v.lines.map(function (l) { return '<div class="rn-row"><span>' + esc(l.label) + (l.quantity > 1 ? ' <span class="rn-qty">× ' + l.quantity + "</span>" : "") + "</span><span>" + usd(l.amount) + "</span></div>"; }).join("");
    var sum = '<div class="rn-sum"><div class="rn-co">' + esc(v.company.name) + "</div>" + rows + (v.product.includes ? '<div class="rn-inc">Includes ' + esc(v.product.includes) + "</div>" : "") +
      '<div class="rn-total"><span>Per month</span><b>' + usd(v.total) + "</b></div></div>";
    var note = v.others && v.others.length ? '<p class="rn-note">This pays for ' + esc(NAME) + " only. The other " + v.others.length + " product" + (v.others.length === 1 ? "" : "s") + " in your trial close when it's paid.</p>" : "";
    var act = v.isOwner ? button("Pay " + usd(v.total) + "/month", "rn-go") + SECURE : '<div class="rn-ask">Only an owner can pay.' + owners(v) + "</div>";
    card(pill, tone, title, lede, sum + note + act + '<p class="rn-err" id="rn-err" hidden></p>');
    wire();
  }
  function owners(v) {
    if (!v.owners || !v.owners.length) return "";
    return " Ask " + v.owners.map(function (o) { return '<a href="mailto:' + esc(o.email) + '">' + esc(o.name || o.email) + "</a>"; }).join(", ") + ".";
  }
  function wire() { var g = document.getElementById("rn-go"); if (g) g.addEventListener("click", function () { start(g); }); }

  function load() {
    fetch(API + "/api/billing/renew?product=" + encodeURIComponent(PRODUCT), { credentials: "include", cache: "no-store" })
      .then(function (r) { return r.json(); }).then(render)
      .catch(function () { card("", "bad", "Renew " + NAME, "We couldn't reach payment just now. Please refresh, or write to support@pulsus.tech.", ""); });
  }
  load();
})();
