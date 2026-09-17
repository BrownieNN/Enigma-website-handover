/* ================= FILM LIGHTBOX =================
   Wires the case study's film tile (.al-cs-play) to the overlay in index.html, and reskins Plyr
   into the hairline playhead. All of the LOOK lives in styles.css under "FILM LIGHTBOX"; this
   file owns the wiring, the source swap, and open/close.

   WORDPRESS NOTE -- this is the whole contract with the CMS. A trigger carries its film on two
   data attributes:

       <button class="al-cs-play" data-film-open
               data-film-src="<?php echo esc_url( get_field('film_mp4') ); ?>"
               data-film-poster="<?php echo esc_url( get_field('film_poster') ); ?>">

   so the editor uploads an mp4 to the Media Library, drops it in an ACF field, and nothing here
   changes. Multiple tiles on one page each carry their own src and share this single player --
   the source is swapped on open rather than a player being built per tile. */
(function () {
  var root = document.getElementById("film-lightbox");
  if (!root || typeof Plyr === "undefined") return;

  var videoEl = root.querySelector("video");
  var closeBtn = root.querySelector(".al-film-close");
  var frame = root.querySelector(".al-film-frame");
  var lastFocus = null;
  var currentSrc = videoEl.getAttribute("src") || "";

  var player = new Plyr(videoEl, {
    /* Order IS the layout. styles.css lays the bar out with flex-wrap and relies on `progress`
       being last so it wraps onto its own line as the hairline; the two times must stay
       adjacent for Plyr's "⁄" separator, which is a `.plyr__time + .plyr__time` rule. */
    controls: ["current-time", "duration", "play", "mute", "volume", "fullscreen", "progress"],

    /* The sprite is inlined in index.html instead of fetched. Chrome will not resolve an
       external file in <use href>, so Plyr's default is to XHR the sprite and inject it -- which
       in turn dies on file:// . Inlining sidesteps both. An empty iconUrl makes Plyr emit bare
       "#plyr-play" fragments that hit the inline symbols. */
    loadSprite: false,
    iconUrl: "",

    hideControls: true,
    clickToPlay: true,
    resetOnEnd: true,
    invertTime: false,
    displayDuration: true,
    keyboard: { focused: true, global: false },
    tooltips: { controls: false, seek: true },
    storage: { enabled: false },
    fullscreen: { enabled: true, fallback: true, iosNative: true }
  });

  /* ---- STAGING ----
     Same shape as the page veil in index.html, and deliberately so: this is the same gesture,
     so it should feel like the same system. Cover closes, a beat of nothing, then the new thing
     arrives -- rather than everything moving at once, which is what read as jolty.

     The numbers ARE the veil's numbers. If the AD retunes one, retune both.

     setTimeout drives the stages, NOT transitionend -- the same reasoning the veil documents:
     rAF and CSS transitions are suspended in a background tab, so transitionend would never
     arrive in exactly the case a net exists for, while setTimeout still fires (throttled).
     Every stage is idempotent and doubled, so a lost or throttled timer cannot strand the
     overlay half-open across the whole viewport. */
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var CFG = {
    in: 0.42,    // the scrim closing over the page / the film fading out
    hold: 0.12,  // solid scrim, nothing moving
    out: 0.5     // the film fading up / the scrim uncovering
  };
  function d(k) { return reduce ? 0 : CFG[k]; }

  /* One timer pool for both directions. Any state change clears it wholesale, which is what
     makes interrupting a half-finished open or close safe -- no stale stage can land later and
     fight the new one. */
  var timers = [];
  function after(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function clearTimers() {
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers = [];
  }

  /* The CSS owns the fades; this keeps its durations in step with CFG so tune() is live. */
  function sync() {
    root.style.setProperty("--film-in", d("in") + "s");
    root.style.setProperty("--film-out", d("out") + "s");
  }

  function playNow() {
    var p = player.play();
    /* Rejected when the browser refuses an unmuted autoplay. Nothing to do -- Plyr leaves the
       centre play button up, which is the intended fallback. Swallowed so it is not an
       unhandled rejection in the console during review. */
    if (p && typeof p.catch === "function") p.catch(function () {});
  }

  function setSource(src, poster) {
    if (!src || src === currentSrc) return false;
    currentSrc = src;
    player.source = {
      type: "video",
      sources: [{ src: src, type: "video/mp4" }],
      poster: poster || undefined
    };
    return true;
  }

  function open(trigger) {
    clearTimers();
    sync();

    /* The trigger is the whole tile, which is a div and cannot hold focus -- calling focus() on
       it on the way out would silently drop focus to the body. Fall through to the real control
       inside it, which is what was tabbed to in the first place. */
    lastFocus = null;
    if (trigger) {
      lastFocus = trigger.matches("button, a, [tabindex]")
        ? trigger
        : trigger.querySelector("button, a, [tabindex]");
    }
    lastFocus = lastFocus || document.activeElement;

    var changed = setSource(
      trigger && trigger.getAttribute("data-film-src"),
      trigger && trigger.getAttribute("data-film-poster")
    );

    root.hidden = false;
    void root.offsetWidth; /* commit the un-hide before .is-open so the transition has a start */

    // STAGE 1 -- the scrim closes over the page. The film is still at opacity 0.
    root.classList.add("is-open");
    document.documentElement.classList.add("film-open");

    // STAGE 2 -- covered, and the beat has passed: light the film.
    var lit = false;
    function light() {
      if (lit) return;
      if (!root.classList.contains("is-open")) return;  // closed again before we got here
      lit = true;
      root.classList.add("is-lit");
      /* Playback starts HERE, not at stage 1, so the film is revealed from its first frame
         rather than half a second in. Still inside the click's user-activation window, so an
         unmuted autoplay is not refused for being too late. */
      if (changed) player.once("ready", playNow);
      else playNow();
      closeBtn.focus({ preventScroll: true });
    }
    after((d("in") + d("hold")) * 1000, light);
    after((d("in") + d("hold")) * 1000 + 400, light);   // net, if the first is throttled or lost
  }

  function close() {
    if (!root.classList.contains("is-open")) return;
    clearTimers();
    sync();

    // STAGE 1 -- the film fades out. Audio stops now: a dismiss that keeps playing is wrong.
    player.pause();
    root.classList.remove("is-lit");
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });

    // STAGE 2 -- film gone, beat passed: the scrim uncovers the page.
    var lifted = false, done = false;
    function lift() {
      if (lifted) return;
      if (root.classList.contains("is-lit")) return;    // reopened before we got here
      lifted = true;
      root.classList.remove("is-open");
      document.documentElement.classList.remove("film-open");
      after(d("out") * 1000 + 300, finish);
    }
    // STAGE 3 -- fully gone. Assert the resting state rather than trusting the stages to have run.
    function finish() {
      if (done) return;
      if (root.classList.contains("is-open")) return;   // reopened mid-uncover
      done = true;
      root.hidden = true;
      try { player.currentTime = 0; } catch (err) {}
    }
    after((d("in") + d("hold")) * 1000, lift);
    after((d("in") + d("hold")) * 1000 + 400, lift);
  }

  document.addEventListener("click", function (e) {
    var trigger = e.target && e.target.closest && e.target.closest("[data-film-open]");
    if (trigger) { e.preventDefault(); open(trigger); }
  });

  closeBtn.addEventListener("click", close);

  /* Scrim click. The frame is a child of root, so anything landing on root itself is outside the
     video -- and clicks INSIDE the video are Plyr's click-to-play, which must not close. */
  root.addEventListener("click", function (e) { if (e.target === root) close(); });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || root.hidden) return;
    /* Fullscreen eats the first Escape to exit itself; don't tear the lightbox down under it. */
    if (player.fullscreen && player.fullscreen.active) return;
    close();
  });

  /* Console handles, matching __VEIL's shape so the two transitions are tuned the same way.
     __FILM.tune({ in, hold, out }) is live -- it rewrites the CSS custom properties and the
     stage timings together on the next open. __FILM.clear() is the panic button if a stage ever
     wedges: this element covers the whole viewport, so a stuck open is an unusable page. */
  window.__filmPlayer = player;
  window.__FILM = {
    cfg: CFG,
    tune: function (o) { Object.assign(CFG, o || {}); sync(); return CFG; },
    state: function () {
      return {
        hidden: root.hidden,
        open: root.classList.contains("is-open"),
        lit: root.classList.contains("is-lit"),
        pending: timers.length,
        scrimOpacity: getComputedStyle(root).opacity
      };
    },
    clear: function () {
      clearTimers();
      player.pause();
      root.classList.remove("is-lit");
      root.classList.remove("is-open");
      document.documentElement.classList.remove("film-open");
      root.hidden = true;
    }
  };
})();
