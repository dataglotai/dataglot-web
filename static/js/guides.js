(function () {
  function copyText(text, btn) {
    var done = function () {
      var prev = btn.getAttribute("data-label") || btn.textContent;
      btn.classList.add("is-copied");
      btn.textContent = "Copied!";
      setTimeout(function () {
        btn.classList.remove("is-copied");
        btn.textContent = prev;
      }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(done)
        .catch(function () {});
    }
  }

  function makeCopyButton(pre) {
    var code = pre.querySelector("code");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-block__btn code-block__copy";
    btn.textContent = "Copy";
    btn.setAttribute("data-label", "Copy");
    btn.addEventListener("click", function () {
      copyText((code || pre).innerText, btn);
    });
    return btn;
  }

  // Standalone code block: language label + wrap toggle + copy button.
  function enhanceStandalonePre(pre) {
    if (pre.parentNode && pre.parentNode.classList.contains("code-block"))
      return;
    var code = pre.querySelector("code");
    var lang =
      pre.getAttribute("data-lang") ||
      (code && code.getAttribute("data-lang")) ||
      "";

    var wrapper = document.createElement("div");
    wrapper.className = "code-block";

    var toolbar = document.createElement("div");
    toolbar.className = "code-block__toolbar";

    var langEl = document.createElement("span");
    langEl.className = "code-block__lang";
    // "text"/"code"/"markdown"/"plain"/empty are non-languages — show no label for them.
    var normLang = (lang || "").toLowerCase();
    langEl.textContent =
      normLang === "" ||
      normLang === "text" ||
      normLang === "code" ||
      normLang === "markdown" ||
      normLang === "plain" ||
      normLang === "plaintext"
        ? ""
        : lang;
    toolbar.appendChild(langEl);

    var actions = document.createElement("div");
    actions.className = "code-block__actions";

    var wrapBtn = document.createElement("button");
    wrapBtn.type = "button";
    wrapBtn.className = "code-block__btn code-block__wrap";
    wrapBtn.textContent = "Wrap";
    wrapBtn.addEventListener("click", function () {
      pre.classList.toggle("is-wrapped");
      wrapBtn.classList.toggle("is-active");
    });
    actions.appendChild(wrapBtn);

    actions.appendChild(makeCopyButton(pre));

    toolbar.appendChild(actions);

    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(toolbar);
    wrapper.appendChild(pre);
  }

  function panelPre(panel) {
    return panel.tagName === "PRE" ? panel : panel.querySelector("pre");
  }

  // Tabbed container rendered as a single code block: one header holds the
  // tab labels (left) plus Wrap + Copy (right). panelSelector null => the
  // direct <pre> children are the panels.
  function buildTabs(container, panelSelector) {
    var panels;
    if (panelSelector) {
      panels = Array.prototype.filter.call(container.children, function (el) {
        return el.matches && el.matches(panelSelector);
      });
    } else {
      panels = Array.prototype.filter.call(container.children, function (el) {
        return el.tagName === "PRE";
      });
    }
    if (panels.length === 0) return;

    var labels = (container.getAttribute("data-labels") || "")
      .split(",")
      .map(function (s) {
        return s.trim();
      });

    var toolbar = document.createElement("div");
    toolbar.className = "code-block__toolbar code-block__toolbar--tabs";

    var tabsWrap = document.createElement("div");
    tabsWrap.className = "code-block__tabs";

    var actions = document.createElement("div");
    actions.className = "code-block__actions";

    var wrapBtn = document.createElement("button");
    wrapBtn.type = "button";
    wrapBtn.className = "code-block__btn code-block__wrap";
    wrapBtn.textContent = "Wrap";

    var copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "code-block__btn code-block__copy";
    copyBtn.textContent = "Copy";
    copyBtn.setAttribute("data-label", "Copy");

    actions.appendChild(wrapBtn);
    actions.appendChild(copyBtn);

    var tabButtons = [];
    var activeIndex = 0;

    function setActive(i) {
      activeIndex = i;
      tabButtons.forEach(function (b, j) {
        b.classList.toggle("is-active", j === i);
      });
      panels.forEach(function (p, j) {
        p.classList.toggle("is-active", j === i);
      });
    }

    panels.forEach(function (panel, i) {
      var label = labels[i];
      if (!label) {
        var refPre = panelPre(panel);
        var refLang = (refPre && refPre.getAttribute("data-lang")) || "";
        var normRefLang = refLang.toLowerCase();
        // Ignore non-languages (incl. "plain" from Zola 0.22's highlighter).
        if (
          normRefLang === "" ||
          normRefLang === "text" ||
          normRefLang === "code" ||
          normRefLang === "markdown" ||
          normRefLang === "plain" ||
          normRefLang === "plaintext"
        ) {
          refLang = "";
        }
        label = refLang || "Tab " + (i + 1);
      }
      var tab = document.createElement("button");
      tab.type = "button";
      tab.className = "code-block__tab";
      tab.textContent = label;
      tab.addEventListener("click", function () {
        setActive(i);
      });
      tabsWrap.appendChild(tab);
      tabButtons.push(tab);
      panel.classList.add("tabs__panel");
    });

    wrapBtn.addEventListener("click", function () {
      container.classList.toggle("is-wrapped");
      wrapBtn.classList.toggle("is-active");
    });

    copyBtn.addEventListener("click", function () {
      var pre = panelPre(panels[activeIndex]);
      if (!pre) return;
      var code = pre.querySelector("code");
      copyText((code || pre).innerText, copyBtn);
    });

    toolbar.appendChild(tabsWrap);
    toolbar.appendChild(actions);
    container.insertBefore(toolbar, container.firstChild);
    container.classList.add("tabs--ready");
    setActive(0);
  }

  // Decode a base64 string that holds UTF-8 bytes back into a JS string.
  function decodeBase64Utf8(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  // Strip the TOML front matter, mirroring build-pipeline.js getMarkdownBody().
  function stripFrontMatter(raw) {
    var end = raw.indexOf("+++", 3);
    return (end !== -1 ? raw.slice(end + 3) : raw).trim();
  }

  function initCopyAsMarkdown() {
    var btn = document.getElementById("guides-copy-md");
    if (!btn) return;
    var label = btn.querySelector(".guides-copy-md-label");
    var original = label ? label.textContent : "";

    function flash(msg) {
      if (!label) return;
      label.textContent = msg;
      setTimeout(function () {
        label.textContent = original;
      }, 1500);
    }

    btn.addEventListener("click", function () {
      var encoded = btn.getAttribute("data-md");
      if (!encoded) return flash("Unavailable");

      var markdown;
      try {
        markdown = stripFrontMatter(decodeBase64Utf8(encoded));
      } catch (e) {
        return flash("Unavailable");
      }

      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        return flash("Unavailable");
      }

      navigator.clipboard
        .writeText(markdown)
        .then(function () {
          flash("Copied!");
        })
        .catch(function () {
          flash("Unavailable");
        });
    });
  }

  // Render ```mermaid fences as diagrams (mermaid.min.js is vendored and
  // loaded only when a page actually contains one).
  function initMermaid(content) {
    var blocks = content.querySelectorAll('code[data-lang="mermaid"], code.language-mermaid');
    if (!blocks.length) return;
    var divs = [];
    Array.prototype.forEach.call(blocks, function (code) {
      var pre = code.closest("pre");
      var div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;
      pre.parentNode.replaceChild(div, pre);
      divs.push(div);
    });
    var s = document.createElement("script");
    s.src = "/js/mermaid.min.js";
    s.onload = function () {
      window.mermaid.initialize({ startOnLoad: false, theme: "neutral" });
      window.mermaid.run({ nodes: divs });
    };
    document.body.appendChild(s);
  }

  // "Back to top" in the docs / guides TOC rail. Mirrors the blog rail's
  // behaviour: smooth-scroll instead of a hash jump, and don't leave a
  // stray "#" on the URL.
  function initTocTop() {
    var link = document.getElementById("guides-toc-top");
    if (!link) return;
    link.addEventListener("click", function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // Only offer it once there is somewhere to go back to. rAF-throttled,
    // and run once up front so a deep link (/page/#heading) starts correct.
    var ticking = false;
    function sync() {
      ticking = false;
      var on = window.scrollY > 160;
      link.classList.toggle("is-visible", on);
      link.setAttribute("aria-hidden", String(!on));
      link.tabIndex = on ? 0 : -1;
    }
    window.addEventListener(
      "scroll",
      function () {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(sync);
      },
      { passive: true },
    );
    sync();
  }

  function init() {
    var content = document.getElementById("guides-content");
    if (!content) return;

    initTocTop();
    initMermaid(content);

    Array.prototype.forEach.call(
      content.querySelectorAll(".code-tabs"),
      function (c) {
        buildTabs(c, null);
      },
    );
    Array.prototype.forEach.call(
      content.querySelectorAll(".content-tabs"),
      function (c) {
        buildTabs(c, ".content-tabs__panel");
      },
    );
    Array.prototype.forEach.call(
      content.querySelectorAll("pre"),
      function (pre) {
        if (pre.closest(".code-tabs") || pre.closest(".content-tabs")) return;
        enhanceStandalonePre(pre);
      },
    );

    // lightbox.js loads after this script in the document, so window.initLightbox
    // may not exist yet — wire image zoom now if available, otherwise on load.
    var zoomWired = false;
    function wireZoom() {
      if (zoomWired || !window.initLightbox) return;
      window.initLightbox("#guides-content");
      zoomWired = true;
    }
    wireZoom();
    if (!zoomWired) window.addEventListener("load", wireZoom);

    initCopyAsMarkdown();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
