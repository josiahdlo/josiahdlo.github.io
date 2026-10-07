// Small progressive enhancements. Everything on the site works without this file.
(function () {
  "use strict";

  // ---- Navigation: mobile menu + border on scroll ----
  var nav = document.querySelector(".nav");
  var toggle = document.querySelector(".nav__toggle");
  if (nav && toggle) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    nav.querySelectorAll(".nav__links a").forEach(function (a) {
      a.addEventListener("click", function () {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }
  if (nav) {
    var onScroll = function () { nav.classList.toggle("is-scrolled", window.scrollY > 8); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // ---- Footer year ----
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  // ---- Reveal on scroll ----
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  }

  // ---- Table of contents: highlight the section in view ----
  var tocLinks = document.querySelectorAll(".toc a");
  if (tocLinks.length && "IntersectionObserver" in window) {
    var map = {};
    tocLinks.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && map[e.target.id]) {
          tocLinks.forEach(function (a) { a.classList.remove("is-active"); });
          map[e.target.id].classList.add("is-active");
        }
      });
    }, { rootMargin: "-30% 0px -60% 0px" });
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) spy.observe(el);
    });
  }

  // ---- Lightbox for [data-zoom] links ----
  var items = Array.prototype.slice.call(document.querySelectorAll("a[data-zoom]"));
  if (!items.length || typeof HTMLDialogElement === "undefined") return;

  var icon = function (d) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  };
  var dlg = document.createElement("dialog");
  dlg.className = "lightbox";
  dlg.setAttribute("aria-label", "Image viewer");
  dlg.innerHTML =
    '<span class="lb-count label"></span>' +
    '<figure><img alt=""><figcaption></figcaption></figure>' +
    '<button class="lb-close" type="button" aria-label="Close">' + icon("M18 6 6 18M6 6l12 12") + "</button>" +
    '<button class="lb-prev" type="button" aria-label="Previous image">' + icon("m15 18-6-6 6-6") + "</button>" +
    '<button class="lb-next" type="button" aria-label="Next image">' + icon("m9 18 6-6-6-6") + "</button>";
  document.body.appendChild(dlg);

  var img = dlg.querySelector("img");
  var cap = dlg.querySelector("figcaption");
  var count = dlg.querySelector(".lb-count");
  var current = 0;

  function show(i) {
    current = (i + items.length) % items.length;
    var link = items[current];
    var thumb = link.querySelector("img");
    var fig = link.closest("figure");
    var caption = fig && fig.querySelector("figcaption");
    img.src = link.getAttribute("href");
    img.alt = thumb ? thumb.alt : "";
    cap.textContent = caption ? caption.textContent : (thumb ? thumb.alt : "");
    count.textContent = (current + 1) + " / " + items.length;
  }

  items.forEach(function (link, i) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      show(i);
      dlg.showModal();
    });
  });

  dlg.querySelector(".lb-close").addEventListener("click", function () { dlg.close(); });
  dlg.querySelector(".lb-prev").addEventListener("click", function (e) { e.stopPropagation(); show(current - 1); });
  dlg.querySelector(".lb-next").addEventListener("click", function (e) { e.stopPropagation(); show(current + 1); });
  dlg.addEventListener("click", function (e) {
    if (e.target === dlg || e.target.tagName === "FIGURE") dlg.close();
  });
  dlg.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") show(current - 1);
    if (e.key === "ArrowRight") show(current + 1);
  });
  dlg.addEventListener("close", function () { img.removeAttribute("src"); });
})();
