/**
 * Shared across all 8 pages. GA4 event tracking for the click paths that lead
 * to an enquiry or a booking, plus the enquiry form's submit handling and the
 * postMessage bridge that hears back from the booking widget iframe.
 *
 * Delegated at the document level (not per-link) so this one file covers
 * every page without each page needing to know which links exist. Reads
 * hrefs off the DOM rather than matching source text, because pages mix
 * quote styles (href='/contact' in navs, href="https://wa.me/…" in body copy).
 */
(function () {
  var BOOKING_ORIGIN = "https://cstlfalcrum.vercel.app";
  var ENQUIRY_ENDPOINT = BOOKING_ORIGIN + "/api/public/enquiry";

  function send(name, params) {
    if (typeof gtag === "function") gtag("event", name, params || {});
  }

  var here = location.pathname.replace(/\/$/, "") || "/";
  var onContactPage = here === "/contact" || here === "/contact.html";

  document.addEventListener(
    "click",
    function (ev) {
      var a = ev.target.closest && ev.target.closest("a");
      if (!a) return;
      var href = a.getAttribute("href") || "";

      if (a.classList.contains("wa-float")) {
        send("contact_whatsapp", { method: "whatsapp", placement: "float_button", page_path: here });
      } else if (href.indexOf("wa.me") !== -1) {
        send("contact_whatsapp", { method: "whatsapp", placement: "inline_link", page_path: here });
      } else if (href.indexOf("tel:") === 0) {
        send("contact_phone", { page_path: here });
      } else if (href.indexOf("instagram.com") !== -1) {
        send("click_instagram", { page_path: here });
      } else if (!onContactPage && (href === "/contact" || href.indexOf("/contact") === 0 || href.indexOf("/contact.html") === 0)) {
        // Suppressed on the contact page itself — clicking "Contact / Book" while
        // already there isn't intent moving toward the page, it's already arrived.
        send("booking_intent_click", { placement: (a.textContent || "").trim().slice(0, 60), page_path: here });
      }
    },
    true,
  );

  // Booking widget: log when it scrolls into view, so drop-off before it's
  // visible is distinguishable from drop-off after.
  var bookFrame = document.querySelector(".book-frame");
  if (bookFrame && "IntersectionObserver" in window) {
    var seenWidget = false;
    new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !seenWidget) {
            seenWidget = true;
            send("booking_widget_view", { page_path: here });
            obs.disconnect();
          }
        });
      },
      { threshold: 0.4 },
    ).observe(bookFrame);
  }

  // Booking confirmation bridge. The booking app can't carry its own GA tag —
  // it's pre-warmed in a hidden iframe on every homepage visit (see the
  // comment at index.html's pre-warm iframe), so a pageview tag there would
  // fabricate a phantom /book view for every homepage visitor. Instead the
  // booking app posts a message on genuine confirmation and this page turns
  // that into the one GA event that matters. Both origin AND source are
  // checked — origin alone isn't enough to trust a postMessage.
  if (bookFrame) {
    window.addEventListener("message", function (e) {
      if (e.origin !== BOOKING_ORIGIN) return;
      if (e.source !== bookFrame.contentWindow) return;
      if (e.data && e.data.type === "cstl:booking_confirmed") {
        send("booking_confirmed", { clinic: e.data.clinic || "", page_path: here });
      }
    });
  }

  // Enquiry form — the tracked, on-site replacement for the mailto dead end.
  var form = document.getElementById("enquiryForm");
  if (form) {
    var started = false;
    form.addEventListener(
      "focusin",
      function () {
        if (started) return;
        started = true;
        send("enquiry_start", { page_path: here });
      },
      { once: true },
    );

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var statusEl = document.getElementById("enquiryStatus");
      var btn = form.querySelector('button[type="submit"]');

      if (form.company.value) return; // honeypot — bots fill hidden fields, real visitors never see this one

      var name = form.name.value.trim();
      var email = form.email.value.trim();
      var message = form.message.value.trim();

      if (!name || !email || !message) {
        statusEl.textContent = "Please fill in your name, email and message.";
        statusEl.className = "enquiry-status err";
        return;
      }

      btn.disabled = true;
      btn.textContent = "Sending…";
      statusEl.textContent = "";
      statusEl.className = "enquiry-status";

      // Same-origin navigation set this on page load — it's how the form knows
      // which page actually sent someone here, since a full page load (not a
      // popover) is what happens when an email link on another page is clicked.
      var referringPage = sessionStorage.getItem("cstl_enquiry_source") || "";

      fetch(ENQUIRY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          email: email,
          phone: form.phone.value.trim(),
          message: message,
          company: form.company.value,
          page: referringPage || here,
        }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error("request failed");
          return res.json();
        })
        .then(function () {
          send("enquiry_submitted", { page_path: here });
          form.hidden = true;
          statusEl.textContent = "Thanks — I've got your message and will reply within 24 hours.";
          statusEl.className = "enquiry-status ok";
        })
        .catch(function () {
          statusEl.textContent = "Something went wrong sending that — please WhatsApp instead, or email phoenix@tanner.me directly.";
          statusEl.className = "enquiry-status err";
          btn.disabled = false;
          btn.textContent = "Send message";
        });
    });
  }

  // Records which page a visitor arrived from, for the enquiry form's hidden
  // referring-page field. Only meaningful on first landing on /contact — once
  // there, further in-page interaction shouldn't overwrite it.
  if (onContactPage) {
    var ref = document.referrer;
    if (ref && ref.indexOf(location.origin) === 0) {
      var path = ref.slice(location.origin.length).replace(/\/$/, "") || "/";
      if (path !== "/contact" && path !== "/contact.html") {
        sessionStorage.setItem("cstl_enquiry_source", path);
      }
    }
  }
})();
