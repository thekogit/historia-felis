// App boot is isolated: an error while rendering a deep-linked page must never stop the prologue below.
try { (function() {
      'use strict';

      // 1. DATA INITIALIZATION
      const categories = JSON.parse(document.getElementById('data-categories').textContent);
      const artworks = JSON.parse(document.getElementById('data-artworks').textContent);

      const categoryMap = new Map();
      categories.forEach(c => categoryMap.set(c.id, c));

      const artworkSlugMap = new Map();
      artworks.forEach(w => artworkSlugMap.set(w.id, w));

      // Artworks renamed in the editor keep their old IDs in `former_ids`. Old links still open
      // them, and likes saved under an old ID are moved to the current one (see CuratorialStack).
      const formerIdMap = new Map();
      artworks.forEach(w => (Array.isArray(w.former_ids) ? w.former_ids : []).forEach(old => {
        if (old && !artworkSlugMap.has(old)) formerIdMap.set(old, w.id);
      }));
      formerIdMap.forEach((id, old) => artworkSlugMap.set(old, artworkSlugMap.get(id)));

      // Shared motion values (mirror the CSS tokens in :root)
      const Motion = (() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const D = { instant: 90, fast: 160, base: 240, slow: 360 };
        return {
          get reduced() { return mq.matches; },
          dur(name) { return mq.matches ? 0 : D[name]; },
          ease: {
            out: 'cubic-bezier(0.16, 1, 0.3, 1)',
            standard: 'cubic-bezier(0.2, 0, 0, 1)',
            in: 'cubic-bezier(0.4, 0, 1, 1)',
          },
          scroll() { return mq.matches ? 'auto' : 'smooth'; },
        };
      })();

      function cancelAnims(el) {
        el.getAnimations().forEach(a => a.cancel());
      }

      function setActiveEra(eraId) {
        if (!eraId) return;
        const eraNums = document.querySelectorAll('.era-num');
        eraNums.forEach(el => {
          if (el.dataset.eraId === eraId) {
            el.classList.add('active');
          } else {
            el.classList.remove('active');
          }
        });
      }

      let isProgrammaticEraScroll = false;
      let eraScrollLockTimer = null;
      let eraScrollCancel = null;

      function programScrollToEra(targetEraId) {
        const targetEl = document.getElementById(`era-node-${targetEraId}`);
        if (!targetEl) return;
        if (eraScrollCancel) eraScrollCancel();

        isProgrammaticEraScroll = true;
        setActiveEra(targetEraId);
        clearTimeout(eraScrollLockTimer);

        const headerHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 56;
        const offset = () => targetEl.getBoundingClientRect().top - headerHeight;
        const aim = behavior => window.scrollTo({ top: offset() + window.scrollY, behavior });

        // Far jumps (e.g. 0 → 13) don't travel: a smooth scroll through hundreds of cards renders
        // and loads every one on the way, and their real heights keep shoving the target down.
        // Instead the timeline dips out, the target era and its neighbours are readied (images
        // requested, cards pre-revealed), we jump in one step and it comes back in place.
        // Cards above stay unrendered placeholders, and scroll anchoring keeps the era heading
        // fixed while whatever is near it settles, so nothing visibly jumps.
        const far = Math.abs(offset()) > window.innerHeight * 1.5;
        if (far) {
          const page = document.querySelector('.timeline-page') || appRoot;
          const order = [...document.querySelectorAll('.era-heading-node')].map(n => n.dataset.eraId);
          const at = order.indexOf(targetEraId);
          const near = new Set([order[at - 1], targetEraId, order[at + 1]].filter(Boolean));
          const dur = Motion.reduced ? 0 : 140;
          cancelAnims(page);
          const out = page.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: 'ease-in', fill: 'forwards' });
          const land = () => {
            document.querySelectorAll('[data-era-id]').forEach(el => {
              if (!near.has(el.dataset.eraId) || el.classList.contains('era-num')) return;
              if (el.dataset.eraId === targetEraId && el.classList.contains('timeline-item')) el.classList.add('revealed');
              // Each card's first frame is enough; the slider loads the rest on demand
              el.querySelectorAll('.card-thumb-wrap').forEach(w => {
                const img = w.querySelector('img[loading="lazy"]');
                if (img) img.loading = 'eager';
              });
            });
            aim('instant');
            // Cards around the landing spot render over the next few frames and their real
            // heights push the heading down. While still hidden, keep re-aiming until it has
            // stayed put for several frames, and only then fade the timeline back in.
            const t0 = performance.now();
            let still = 0;
            const settle = () => {
              if (Math.abs(offset()) > 2) { aim('instant'); still = 0; } else still++;
              if (still < 6 && performance.now() - t0 < 900) { requestAnimationFrame(settle); return; }
              cancelAnims(page);
              if (dur) page.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: Motion.ease.out });
              setActiveEra(targetEraId);
              // The side/mobile era labels follow scrolling, which an instant jump skips
              const eraName = targetEl.dataset.eraName || '';
              const movName = document.querySelector(`.timeline-item[data-era-id="${targetEraId}"], .timeline-spotlight-item[data-era-id="${targetEraId}"]`)?.dataset.movName || '';
              [sideEraLabel, mobileEraTitle].forEach(el => { if (el) el.textContent = eraName; });
              [sideMovLabel, mobileMovTitle].forEach(el => { if (el) el.textContent = movName; });
              clearTimeout(eraScrollLockTimer);
              eraScrollLockTimer = setTimeout(() => { isProgrammaticEraScroll = false; }, 250);
            };
            requestAnimationFrame(settle);
          };
          if (dur) out.finished.then(land, land); else land();
          return;
        }

        aim(Motion.scroll());

        // Images above the target load while we travel and push it further down, so a
        // single scrollTo can land eras short. Re-aim each time the scroll comes to rest,
        // until the era heading sits under the header (or the page can't scroll further).
        const startedAt = performance.now();
        let lastY = -1;
        let poll = null;
        const release = () => {
          clearInterval(poll);
          ['wheel', 'touchstart', 'keydown'].forEach(t => window.removeEventListener(t, release));
          eraScrollCancel = null;
          eraScrollLockTimer = setTimeout(() => { isProgrammaticEraScroll = false; }, 150);
        };
        ['wheel', 'touchstart', 'keydown'].forEach(t => window.addEventListener(t, release, { passive: true }));
        eraScrollCancel = release;

        poll = setInterval(() => {
          const y = window.scrollY;
          const resting = Math.abs(y - lastY) < 1;
          lastY = y;
          if (!resting) return;
          const atBottom = y >= document.documentElement.scrollHeight - window.innerHeight - 1;
          const off = offset();
          if (Math.abs(off) <= 4 || (off > 0 && atBottom) || performance.now() - startedAt > 5000) {
            setActiveEra(targetEraId);
            release();
          } else {
            aim(Motion.scroll());
          }
        }, 160);
      }

      const eraIndexBar = document.getElementById('era-index-bar');
      if (eraIndexBar) {
        eraIndexBar.addEventListener('click', e => {
          const btn = e.target.closest('.era-num');
          if (!btn) return;
          const targetEraId = btn.dataset.eraId;
          if (!targetEraId) return;
          const currentRoute = getRoute();
          if (currentRoute.page === 'timeline') {
            e.preventDefault();
            programScrollToEra(targetEraId);
          }
        });
      }

      // Theme Controller
      function setupThemeController() {
        const toggleBtn = document.getElementById('theme-toggle');
        const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');

        function applyTheme(theme, save) {
          document.documentElement.setAttribute('data-theme', theme);
          if (toggleBtn) {
            toggleBtn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
            toggleBtn.setAttribute('title', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
          }
          if (colorSchemeMeta) {
            colorSchemeMeta.setAttribute('content', theme);
          }
          if (save) {
            try {
              localStorage.setItem('theme', theme);
            } catch (e) {}
          }
        }

        const initialTheme = document.documentElement.getAttribute('data-theme') || 'light';
        applyTheme(initialTheme, false);

        if (toggleBtn) {
          toggleBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            applyTheme(next, true);
          });
        }


      }
      setupThemeController();

      const appRoot = document.getElementById('app-root');
      const navTimeline = document.getElementById('nav-timeline');
      const navCategories = document.getElementById('nav-categories');
      const navHaikus = document.getElementById('nav-haikus');
      const navStack = document.getElementById('nav-stack');
      const sideIndicator = document.getElementById('side-indicator');
      const sideEraLabel = document.getElementById('side-era-label');
      const sideMovLabel = document.getElementById('side-mov-label');
      const mobileEraBar = document.getElementById('mobile-era-bar');
      const mobileEraTitle = document.getElementById('mobile-era-title');
      const mobileMovTitle = document.getElementById('mobile-mov-title');
      const tintOverlay = document.getElementById('tint-overlay');

      const scrollMemory = new Map();
      let lastRoute = '';
      let activeLoupeInstance = null;

      const hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
      let isDesktopPointer = hoverQuery.matches;
      hoverQuery.addEventListener('change', e => {
        isDesktopPointer = e.matches;
        if (!isDesktopPointer && activeLoupeInstance) {
          activeLoupeInstance.destroy();
          activeLoupeInstance = null;
        }
      });

      // 2. IMAGE UTILITIES & ERROR RESILIENCE
      function getOptimizedImageUrl(url, width = 600, quality = 80) {
        if (!url || typeof url !== 'string') return url;
        const trimmed = url.trim();
        if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.endsWith('.svg')) {
          return trimmed;
        }
        if (trimmed.includes('wsrv.nl/?url=')) {
          return trimmed;
        }
        if (trimmed.startsWith('./') || trimmed.startsWith('/') || !trimmed.startsWith('http')) {
          return trimmed;
        }
        return `https://wsrv.nl/?url=${encodeURIComponent(trimmed)}&w=${width}&output=webp&q=${quality}&we=1&il=1`;
      }

      // Pre-built local variants: build.js attaches work.local[originalUrl] = { base, widths, w, h }
      function localVariant(work, url) {
        return (work && work.local && typeof url === 'string' && work.local[url.trim()]) || null;
      }
      function localUrl(work, url, minWidth) {
        const v = localVariant(work, url);
        if (!v) return null;
        const pick = v.widths.find(x => x >= minWidth) || v.widths[v.widths.length - 1];
        return `${v.base}-${pick}.webp`;
      }
      // Best URL for one image: local variant → raw source for hotlinked (copyrighted) works,
      // which must never pass through a resizing proxy → wsrv.nl CDN otherwise
      function displayUrl(work, url, width) {
        if (work && work.hotlink) return typeof url === 'string' ? url.trim() : url;
        return localUrl(work, url, width) || getOptimizedImageUrl(url, width);
      }
      // src + srcset + sizes + width/height (no layout shift); CDN fallback when not pre-built
      function imgAttrs(work, url, width, sizes) {
        const v = !(work && work.hotlink) && localVariant(work, url);
        if (!v) return `src="${displayUrl(work, url, width)}"`;
        const srcset = v.widths.map(x => `${v.base}-${x}.webp ${x}w`).join(', ');
        return `src="${localUrl(work, url, width)}" srcset="${srcset}" sizes="${sizes}" width="${v.w}" height="${v.h}"`;
      }

      function getArtworkImages(work) {
        if (!work) return [];
        const urls = [];
        const primary = work.image_url || work.large_url || work.thumb_url;
        if (primary && typeof primary === 'string' && primary.trim()) {
          urls.push(primary.trim());
        }

        if (Array.isArray(work.additional_images)) {
          work.additional_images.forEach(u => {
            if (u && typeof u === 'string' && u.trim() && !urls.includes(u.trim())) {
              urls.push(u.trim());
            }
          });
        }
        if (Array.isArray(work.images)) {
          work.images.forEach(u => {
            if (u && typeof u === 'string' && u.trim() && !urls.includes(u.trim())) {
              urls.push(u.trim());
            }
          });
        }
        return urls.length > 0 ? urls : (primary ? [primary] : []);
      }

      function getArtworkAspect(work) {
        if (!work) return 1.0;
        if (work.aspect_ratio && typeof work.aspect_ratio === 'number') {
          return work.aspect_ratio;
        }
        const images = getArtworkImages(work);
        let maxW = 0;
        let maxH = 0;
        images.forEach(u => {
          const v = localVariant(work, u);
          if (v && v.w && v.h) {
            if (v.w > maxW) maxW = v.w;
            if (v.h > maxH) maxH = v.h;
          }
        });
        if (maxW > 0 && maxH > 0) {
          return +(maxW / maxH).toFixed(4);
        }
        return 1.0;
      }

      // Blur-up: the 8px placeholder from the build sits behind the image until it loads
      const lqClass = work => (work && work.lq && !work.hotlink ? ' has-lq' : '');
      const lqStyle = work => (work && work.lq && !work.hotlink && /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(work.lq) ? ` --lq: url('${work.lq}');` : '');

      // Render Card Media: single image or multi-image swipe slider with locked dimensions
      function renderCardMedia(work, width = 500, sizes = '', eager = false) {
        if (!work) return '';
        const images = getArtworkImages(work);
        const primary = images[0] || work.image_url || work.thumb_url || '';

        if (images.length <= 1) {
          return `
            <img ${imgAttrs(work, primary, width, sizes)} data-raw-src="${escapeAttr(primary)}" alt="${escapeAttr(work.title_eng || work.title)}" ${eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async" onload="window.handleCardImageLoad(this)" onerror="window.handleImageError(this, ${jsArg(work.inv_number)}, ${jsArg(work.title)}, ${jsArg(work.artist)}, ${jsArg(work.source_url)})">
          `;
        }

        // Infinite loop slides: [clone of last, slide 0, slide 1, ..., clone of first]
        const slides = [
          { url: images[images.length - 1], index: images.length - 1, isClone: true, label: images.length },
          ...images.map((url, idx) => ({ url, index: idx, isClone: false, label: idx + 1 })),
          { url: images[0], index: 0, isClone: true, label: 1 }
        ];

        return `
          <div class="card-multi-slider" data-work-id="${work.id}" data-total-slides="${images.length}" onclick="event.stopPropagation();">
            <div class="card-slider-track" onscroll="window.handleCardSliderScroll(this)">
              ${slides.map((s, itemIdx) => `
                <div class="card-slider-slide ${s.isClone ? 'is-clone' : ''}" data-item-index="${itemIdx}" data-slide-index="${s.index}" onclick="if (!window.isCardSwiping) window.handleCardSlideClick(event, this, '${work.id}');">
                  <img ${imgAttrs(work, s.url, width, sizes)} data-raw-src="${escapeAttr(s.url)}" alt="${escapeAttr(work.title_eng || work.title)} [${s.label}/${images.length}]" ${s.index === 0 && eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async" onload="window.handleCardImageLoad(this)" onerror="window.handleImageError(this, ${jsArg(work.inv_number)}, ${jsArg(work.title)}, ${jsArg(work.artist)}, ${jsArg(work.source_url)})">
                </div>
              `).join('')}
            </div>
            <div class="card-slider-pips" aria-hidden="true">
              ${images.map((_, idx) => `<span class="card-slider-pip ${idx === 0 ? 'active' : ''}"></span>`).join('')}
            </div>
            <button type="button" class="card-slider-arrow prev" aria-label="Previous image" onclick="event.stopPropagation(); window.stepCardImage(this, -1);">
              <svg width="14" height="24" viewBox="0 0 14 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="12 2 2 12 12 22"/>
              </svg>
            </button>
            <button type="button" class="card-slider-arrow next" aria-label="Next image" onclick="event.stopPropagation(); window.stepCardImage(this, 1);">
              <svg width="14" height="24" viewBox="0 0 14 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="2 2 12 12 2 22"/>
              </svg>
            </button>
            <span class="card-slider-counter tabular">1/${images.length}</span>
          </div>
        `;
      }

      window.isCardSwiping = false;
      let cardSwipeStartX = 0;
      let cardSwipeStartY = 0;
      window.addEventListener('touchstart', e => {
        if (e.target.closest('.card-slider-track')) {
          cardSwipeStartX = e.touches[0].clientX;
          cardSwipeStartY = e.touches[0].clientY;
          window.isCardSwiping = false;
        }
      }, { passive: true });
      window.addEventListener('touchmove', e => {
        if (cardSwipeStartX && e.touches[0]) {
          const dx = Math.abs(e.touches[0].clientX - cardSwipeStartX);
          const dy = Math.abs(e.touches[0].clientY - cardSwipeStartY);
          if (dx > 8 || dy > 8) {
            window.isCardSwiping = true;
          }
        }
      }, { passive: true });
      window.addEventListener('touchend', () => {
        setTimeout(() => { window.isCardSwiping = false; cardSwipeStartX = 0; cardSwipeStartY = 0; }, 100);
      }, { passive: true });

      window.initCardSliders = function(root = document) {
        root.querySelectorAll('.card-multi-slider').forEach(slider => {
          if (slider.dataset.sliderInit) return;
          slider.dataset.sliderInit = '1';
          const track = slider.querySelector('.card-slider-track');
          if (!track) return;
          const slideWidth = track.clientWidth || (track.firstElementChild && track.firstElementChild.getBoundingClientRect().width) || 0;
          if (slideWidth > 0) {
            track.scrollLeft = slideWidth; // Start at real slide 0 (after cloned last slide)
          } else {
            // If hidden or layout not yet calculated, defer initial positioning
            requestAnimationFrame(() => {
              const sw = track.clientWidth || (track.firstElementChild && track.firstElementChild.getBoundingClientRect().width) || 0;
              if (sw > 0 && track.scrollLeft === 0) {
                track.scrollLeft = sw;
              }
            });
          }
        });
      };

      window.stepCardImage = function(btn, dir) {
        const slider = btn.closest('.card-multi-slider');
        if (!slider) return;
        const track = slider.querySelector('.card-slider-track');
        if (!track) return;
        const totalItems = track.children.length; // N + 2
        const origCount = parseInt(slider.dataset.totalSlides, 10) || (totalItems - 2);
        if (origCount <= 1 || totalItems < 3) return;

        const slideWidth = track.clientWidth || (track.firstElementChild && track.firstElementChild.getBoundingClientRect().width) || 200;
        let currentItem = Math.round(track.scrollLeft / slideWidth);

        // If currently at clone of first (item = origCount + 1), instantaneously normalize to real 1st
        if (currentItem >= origCount + 1) {
          track.style.scrollBehavior = 'auto';
          track.scrollLeft = slideWidth;
          void track.offsetWidth;
          track.style.scrollBehavior = '';
          currentItem = 1;
        } else if (currentItem <= 0) {
          // If currently at clone of last (item = 0), instantaneously normalize to real last
          track.style.scrollBehavior = 'auto';
          track.scrollLeft = origCount * slideWidth;
          void track.offsetWidth;
          track.style.scrollBehavior = '';
          currentItem = origCount;
        }

        const nextItem = currentItem + dir;
        track.scrollTo({ left: nextItem * slideWidth, behavior: Motion.scroll() });
      };

      window.handleCardSlideClick = function(event, slideEl, workId) {
        if (window.isCardSwiping) return;
        const rect = slideEl.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const width = rect.width;

        // If clicked on left edge (within 24% or 60px of the left border), step backward
        const edgeThreshold = Math.min(60, width * 0.24);
        if (clickX <= edgeThreshold) {
          event.stopPropagation();
          window.stepCardImage(slideEl, -1);
          return;
        }
        // If clicked on right edge (within 24% or 60px of the right border), step forward
        if (clickX >= width - edgeThreshold) {
          event.stopPropagation();
          window.stepCardImage(slideEl, 1);
          return;
        }

        // Center clicked -> Navigate to artwork dossier
        window.location.hash = `#/work/${workId}`;
      };

      window.handleCardSliderScroll = function(track) {
        const slider = track.closest('.card-multi-slider');
        if (!slider) return;
        const totalItems = track.children.length;
        const origCount = parseInt(slider.dataset.totalSlides, 10) || (totalItems - 2);
        if (origCount <= 1 || totalItems < 3) return;

        const slideWidth = track.clientWidth || 1;
        const currentItem = Math.round(track.scrollLeft / slideWidth);

        // Map item index [0 ... N+1] to real slide index [0 ... N-1]
        let realIndex = 0;
        if (currentItem <= 0) {
          realIndex = origCount - 1; // clone of last
        } else if (currentItem >= origCount + 1) {
          realIndex = 0; // clone of first
        } else {
          realIndex = currentItem - 1;
        }

        const pips = slider.querySelectorAll('.card-slider-pip');
        pips.forEach((pip, idx) => {
          pip.classList.toggle('active', idx === realIndex);
        });
        const counter = slider.querySelector('.card-slider-counter');
        if (counter && pips.length > 0) {
          counter.textContent = `${realIndex + 1}/${pips.length}`;
        }

        // Seamless infinite loop wrap: when momentum or smooth scroll settles on a clone, jump to real slide
        clearTimeout(track._infiniteTimer);
        track._infiniteTimer = setTimeout(() => {
          const settledItem = Math.round(track.scrollLeft / slideWidth);
          if (settledItem >= origCount + 1) {
            track.style.scrollBehavior = 'auto';
            track.scrollLeft = slideWidth; // Real slide 0
            void track.offsetWidth;
            track.style.scrollBehavior = '';
          } else if (settledItem <= 0) {
            track.style.scrollBehavior = 'auto';
            track.scrollLeft = origCount * slideWidth; // Real slide N-1
            void track.offsetWidth;
            track.style.scrollBehavior = '';
          }
        }, 120);
      };

      window.handleCardImageLoad = function(img) {
        if (img) img.classList.add('is-loaded');
        if (!img || !img.naturalWidth || !img.naturalHeight) return;
        const container = img.closest('.card-thumb-wrap, .grid-card-thumb');
        if (!container) return;
        const curW = parseFloat(container.dataset.photoMaxW) || 0;
        const curH = parseFloat(container.dataset.photoMaxH) || 0;
        const newW = Math.max(curW, img.naturalWidth);
        const newH = Math.max(curH, img.naturalHeight);
        if (newW !== curW || newH !== curH) {
          container.dataset.photoMaxW = newW;
          container.dataset.photoMaxH = newH;
          const ratio = (newW / newH).toFixed(4);
          container.style.aspectRatio = ratio;
        }
      };

      window.handleImageError = function(img, invNumber, title, artist, sourceUrl) {
        if (!img) return;
        img.classList.add('is-loaded'); // never leave a failed image hidden behind its placeholder

        // Phase 0: a pre-built local variant failed (e.g. not deployed) → back to the CDN path
        // srcset (cards) or a plain local src (detail carousel) — the second case used to skip the fallback
        if (!img.dataset.localRetried && (img.hasAttribute('srcset') || /(^|\/)assets\/img\//.test(img.getAttribute('src') || ''))) {
          img.dataset.localRetried = '1';
          img.removeAttribute('srcset');
          img.removeAttribute('sizes');
          const raw = img.dataset.rawSrc;
          if (raw) { img.src = getOptimizedImageUrl(raw, 800); return; }
        }

        // Phase 1: If an edge CDN proxied URL fails, seamlessly fall back to the raw original URL
        if (!img.dataset.proxyRetried) {
          img.dataset.proxyRetried = '1';
          const src = img.currentSrc || img.src || '';
          if (src.includes('wsrv.nl')) {
            const raw = img.dataset.rawSrc || '';
            if (raw && raw !== src) {
              img.src = raw;
              return;
            }
            try {
              const parsed = new URL(src);
              const fallback = parsed.searchParams.get('url');
              if (fallback) {
                img.src = decodeURIComponent(fallback);
                return;
              }
            } catch (e) {}
          }
        }

        if (!img.dataset.retried) {
          img.dataset.retried = '1';
          const src = img.currentSrc || img.src || '';
          if (src.includes('/commons/thumb/')) {
            const match = src.match(/[/]commons[/]thumb[/]([^/]+)[/]([^/]+)[/]([^/]+)[/]/);
            if (match) {
              img.src = `https://upload.wikimedia.org/wikipedia/commons/${match[1]}/${match[2]}/${match[3]}`;
              return;
            }
          } else if (src.includes('upload.wikimedia.org/wikipedia/commons/')) {
            const parts = src.split('/commons/')[1].split('/');
            if (parts.length >= 3) {
              img.src = `https://upload.wikimedia.org/wikipedia/commons/thumb/${parts[0]}/${parts[1]}/${parts[2]}/800px-${parts[2]}`;
              return;
            }
          }
        }

        // If this is an extra slide in a multi-angle carousel, remove the broken slide cleanly
        if (img.classList && img.classList.contains('slide') && Number(img.dataset.slideIndex) > 0) {
          if (img.parentNode) img.parentNode.removeChild(img);
          return;
        }

        const placeholder = document.createElement('div');
        placeholder.className = 'img-placeholder-box crop-box';
        const safeHref = /^https?:\/\//i.test(sourceUrl || '') ? sourceUrl : '#';
        placeholder.innerHTML = `
          <div class="placeholder-inv">${escapeAttr(invNumber || 'ARCHIVE Nº')}</div>
          <div class="placeholder-title">${escapeAttr(title || 'Artwork')}</div>
          <div class="placeholder-artist">${escapeAttr(artist || 'Unknown Artist')}</div>
          <a class="placeholder-link" href="${escapeAttr(safeHref)}" target="_blank" rel="noopener noreferrer">
            VIEW AT MUSEUM RECORD ↗
          </a>
        `;
        if (img && img.parentNode) {
          img.parentNode.replaceChild(placeholder, img);
        }
      };

      function getHighResUrl(url) {
        if (!url || typeof url !== 'string') return url;
        if (url.includes('wsrv.nl/?url=')) {
          try {
            const parsed = new URL(url);
            const raw = parsed.searchParams.get('url');
            if (raw) return decodeURIComponent(raw);
          } catch (e) {}
        }
        if (url.includes('/commons/thumb/')) {
          const clean = url.replace('https://thumb.wikimedia.org/', 'https://upload.wikimedia.org/')
                           .replace('/commons/thumb/', '/commons/');
          return clean.substring(0, clean.lastIndexOf('/'));
        }
        return url;
      }

      // ============================================================================
      // RESOLUTION-AWARE LOUPE & LIGHTBOX
      // ============================================================================
      const SLIDE_WIDTH = 1400; // matches the carousel's getOptimizedImageUrl(imgUrl, 1400)
      const LOUPE_CDN_TIERS = [2000, 2800, 3600, 4800];
      const LOUPE_MASTER_THRESHOLD = 4800;
      const LOUPE_MAX_DPR = 3;
      const LOUPE_DEBOUNCE_MS = 180;
      const CORS_FETCH_HOSTS = new Set(['wsrv.nl', 'images.weserv.nl']);

      /** null = the 1400px slide is already sharp enough. Tiers are built from the master URL. */
      function getLoupeResolution(rawUrl, renderedWidth, zoomFactor) {
        const masterUrl = getHighResUrl(rawUrl);
        const dpr = Math.min(window.devicePixelRatio || 1, LOUPE_MAX_DPR);
        const idealWidth = Math.round(renderedWidth * zoomFactor * dpr);
        const saveData = !!(navigator.connection && navigator.connection.saveData);
        const master = { url: masterUrl, width: Infinity, idealWidth, isMaster: true };

        if (idealWidth <= SLIDE_WIDTH) return null;
        if (idealWidth > LOUPE_MASTER_THRESHOLD && !saveData) return master;

        const width = LOUPE_CDN_TIERS.find(t => t >= idealWidth) || LOUPE_CDN_TIERS[LOUPE_CDN_TIERS.length - 1];
        const url = getOptimizedImageUrl(masterUrl, width, 80);
        if (url === masterUrl) return master; // local/SVG/unproxyable: no tiers exist
        return { url, width, idealWidth, isMaster: false };
      }

      const abortError = () => new DOMException('Aborted', 'AbortError');

      /** Load + decode via <img>. Abort is best-effort (src reset). Resolves with the element. */
      function decodeViaImage(src, signal) {
        return new Promise((resolve, reject) => {
          if (signal && signal.aborted) return reject(abortError());
          const img = new Image();
          img.decoding = 'async';
          const cleanup = () => {
            img.onload = img.onerror = null;
            if (signal) signal.removeEventListener('abort', onAbort);
          };
          const onAbort = () => { cleanup(); img.src = ''; reject(abortError()); };
          if (signal) signal.addEventListener('abort', onAbort, { once: true });
          img.onload = () => {
            cleanup();
            (img.decode ? img.decode() : Promise.resolve()).then(() => resolve(img), () => resolve(img));
          };
          img.onerror = () => { cleanup(); reject(new Error('Image failed: ' + src)); };
          img.src = src;
        });
      }

      /** Returns { src, naturalWidth, revoke }. wsrv.nl → fetch (truly abortable); others → <img>. */
      async function loadImageCancellable(url, signal) {
        let host = '';
        try { host = new URL(url, location.href).hostname; } catch (e) {}

        if (!CORS_FETCH_HOSTS.has(host)) {
          const img = await decodeViaImage(url, signal);
          return { src: url, naturalWidth: img.naturalWidth, revoke() {} };
        }

        const res = await fetch(url, { signal, mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + url);
        const blob = await res.blob();
        if (signal.aborted) throw abortError();

        const objectUrl = URL.createObjectURL(blob);
        try {
          const img = await decodeViaImage(objectUrl, signal);
          return { src: objectUrl, naturalWidth: img.naturalWidth, revoke: () => URL.revokeObjectURL(objectUrl) };
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          throw err;
        }
      }

      /** Re-fires when the window moves to a screen with a different DPR. */
      function watchDpr(onChange) {
        let mql = null;
        const handler = () => { onChange(); arm(); };
        const arm = () => {
          mql = window.matchMedia('(resolution: ' + window.devicePixelRatio + 'dppx)');
          mql.addEventListener('change', handler, { once: true });
        };
        arm();
        return () => { if (mql) mql.removeEventListener('change', handler); };
      }

      function createLoupeResolutionManager(loupe, opts) {
        const getRenderedWidth = opts.getRenderedWidth;
        const onNativeWidthKnown = opts.onNativeWidthKnown || function() {};

        let rawUrl = null, baseSrc = null;
        let best = null;             // { src, width, revoke } — width Infinity = full resolution
        let knownNativeWidth = 0;    // master's true pixel width, once learned
        let zoom = 2.5, active = false;
        let controller = null, pendingWidth = 0, timer = 0, generation = 0;
        const stopDprWatch = watchDpr(() => evaluate());

        const cssUrl = u => 'url("' + String(u).replace(/"/g, '\\"') + '")';

        // High-res on top, cached slide underneath: never empty, never flashes.
        // renderLoupe's single-value backgroundSize/backgroundPosition apply to both layers.
        function paint() {
          loupe.style.backgroundImage = [best && best.src, baseSrc].filter(Boolean).map(cssUrl).join(', ');
        }

        function cancelInFlight() {
          clearTimeout(timer);
          if (controller) controller.abort();
          controller = null;
          pendingWidth = 0;
        }

        function evaluate() {
          if (!active || !rawUrl) return;
          const w = getRenderedWidth();
          if (!w) return;
          const tier = getLoupeResolution(rawUrl, w, zoom);
          if (!tier) return;
          const have = best ? best.width : SLIDE_WIDTH;
          if (tier.width <= have) return;          // already sharp enough; never downgrade
          if (tier.width <= pendingWidth) return;  // equal/better tier already on its way
          cancelInFlight();
          pendingWidth = tier.width;
          timer = setTimeout(() => fetchTier(tier), LOUPE_DEBOUNCE_MS);
        }

        async function fetchTier(tier) {
          const gen = generation;
          controller = new AbortController();
          const signal = controller.signal;
          try {
            let result, isFull = tier.isMaster;
            try {
              result = await loadImageCancellable(tier.url, signal);
            } catch (err) {
              if (err.name === 'AbortError' || tier.isMaster) throw err;
              // CDN tier failed (e.g. source too large for the proxy) → try the master
              result = await loadImageCancellable(getHighResUrl(rawUrl), signal);
              isFull = true;
            }
            if (gen !== generation || signal.aborted) { result.revoke(); return; }

            // &we=1 returns the source at native size when it's smaller than requested:
            // that means we already hold every pixel the master has.
            if (!isFull && result.naturalWidth && result.naturalWidth < tier.width - 2) isFull = true;
            if (isFull && result.naturalWidth) {
              knownNativeWidth = result.naturalWidth;
              onNativeWidthKnown(knownNativeWidth);
            }

            const previous = best;
            best = { src: result.src, width: isFull ? Infinity : tier.width, revoke: result.revoke };
            paint();
            if (previous) setTimeout(() => previous.revoke(), 500); // after the new layer has painted
          } catch (err) {
            if (err.name !== 'AbortError') console.warn('[loupe] high-res upgrade failed:', err);
          } finally {
            if (controller && controller.signal === signal) { controller = null; pendingWidth = 0; }
          }
        }

        return {
          setSource(nextRawUrl, nextBaseSrc) {
            generation++;
            cancelInFlight();
            if (best) best.revoke();
            best = null;
            knownNativeWidth = 0;
            rawUrl = nextRawUrl;
            baseSrc = nextBaseSrc || null;
            paint();
            evaluate();
          },
          setZoom(z) { zoom = z; evaluate(); },
          activate() { active = true; evaluate(); },
          deactivate() { active = false; cancelInFlight(); }, // keeps best for re-enable
          reevaluate: evaluate,
          getKnownNativeWidth() { return knownNativeWidth; },
          destroy() {
            generation++;
            cancelInFlight();
            if (best) best.revoke();
            best = null;
            stopDprWatch();
            loupe.style.backgroundImage = '';
            rawUrl = baseSrc = null;
          }
        };
      }

      // 3. HASH ROUTING CONTROLLER
      function getRoute() {
        const hash = window.location.hash || '#/timeline';
        const cleanHash = hash.startsWith('#/') ? hash.slice(2) : (hash.startsWith('#') ? hash.slice(1) : hash);
        const [path, queryStr] = cleanHash.split('?');
        const parts = path.split('/');
        const query = {};
        if (queryStr) {
          queryStr.split('&').forEach(pair => {
            const [k, v] = pair.split('=');
            if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || '');
          });
        }
        const KNOWN_PAGES = ['timeline', 'categories', 'category', 'work', 'stack', 'dossier', 'poet'];
        return {
          raw: hash,
          page: KNOWN_PAGES.includes(parts[0]) ? parts[0] : 'timeline',
          param: parts[1] || null,
          query: query
        };
      }

      // Rotating a tablet across 900px doesn't re-run navigate(), so re-sync the
      // bottom era bar (whose height the ribbons' bottom edge depends on)
      window.matchMedia('(max-width: 899px)')
        .addEventListener('change', () => updateNavActive(getRoute().page));

      function updateNavActive(page) {
        if (eraIndexBar) {
          eraIndexBar.style.display = (page === 'dossier' || page === 'poet') ? 'none' : '';
        }
        // Category, sub-category and artwork pages live under CATEGORIES; unknown routes
        // render the timeline (see navigate()), so they highlight TIMELINE too
        const activeNav = ['categories', 'category', 'work'].includes(page) ? navCategories
          : page === 'stack' ? navStack
          : (page === 'dossier' || page === 'poet') ? navHaikus
          : navTimeline;
        [navTimeline, navCategories, navHaikus, navStack].forEach(a => {
          if (a) a.classList.toggle('active', a === activeNav);
        });

        if (activeNav === navTimeline) {
          const wide = window.innerWidth >= 900;
          sideIndicator.style.display = wide ? 'flex' : 'none';
          mobileEraBar.style.display = wide ? 'none' : 'flex';
        } else {
          sideIndicator.style.display = 'none';
          mobileEraBar.style.display = 'none';
          tintOverlay.style.backgroundColor = 'transparent';
        }
      }

      // ============================================================================
      // CURATORIAL STACK (PERSISTENT LIKES)
      // ============================================================================
      const CuratorialStack = {
        KEY: 'felis_curatorial_stack',
        getIds() {
          try {
            const raw = localStorage.getItem(this.KEY);
            const arr = JSON.parse(raw || '[]');
            if (!Array.isArray(arr)) return [];
            // Likes survive catalogue updates: IDs of renamed artworks move to the new ID, and IDs
            // that aren't in the catalogue right now are kept (never pruned) in case they come back.
            const unique = Array.from(new Set(arr.map(id => formerIdMap.get(id) || id)));
            if (unique.length !== arr.length || unique.some((id, i) => id !== arr[i])) {
              try {
                localStorage.setItem(this.KEY, JSON.stringify(unique));
              } catch (_) {}
            }
            return unique;
          } catch (e) {
            return [];
          }
        },
        has(id) {
          if (!id) return false;
          const ids = this.getIds();
          if (ids.includes(id)) return true;
          const altId = id.startsWith('haiku:') ? id.slice(6) : ('haiku:' + id);
          return ids.includes(altId);
        },
        add(id) {
          if (!id) return 'invalid';
          const ids = this.getIds();
          if (!this.has(id)) {
            ids.push(id);
            localStorage.setItem(this.KEY, JSON.stringify(ids));
            this.updateBadge();
            return 'added';
          }
          return 'duplicate';
        },
        remove(id) {
          if (!id) return 'invalid';
          let ids = this.getIds();
          const altId = id.startsWith('haiku:') ? id.slice(6) : ('haiku:' + id);
          ids = ids.filter(x => x !== id && x !== altId);
          localStorage.setItem(this.KEY, JSON.stringify(ids));
          this.updateBadge();
          return 'removed';
        },
        toggle(id) {
          if (this.has(id)) {
            this.remove(id);
            return 'removed';
          } else {
            this.add(id);
            return 'added';
          }
        },
        clear() {
          localStorage.setItem(this.KEY, JSON.stringify([]));
          this.updateBadge();
        },
        count() {
          return this.getIds().length;
        },
        getHaikuIds() {
          return this.getIds().filter(id => id.startsWith('haiku:'));
        },
        getWorkIds() {
          return this.getIds().filter(id => !id.startsWith('haiku:'));
        },
        updateBadge() {
          const badge = document.getElementById('stack-count-badge');
          if (badge) {
            const c = this.count();
            badge.textContent = `[${c}]`;
          }
        }
      };
      window.CuratorialStack = CuratorialStack;

      function pulseEl(el) {
        if (!el) return;
        el.classList.remove('motion-pulse');
        void el.offsetWidth;
        el.classList.add('motion-pulse');
        el.addEventListener('animationend', () => el.classList.remove('motion-pulse'), { once: true });
      }

      function swapStackIcon(btn, inStack) {
        const svg = btn.querySelector('svg');
        if (!svg) return;
        svg.setAttribute('fill', inStack ? 'currentColor' : 'none');
        svg.classList.remove('icon-swap-in');
        void svg.getBoundingClientRect();
        svg.classList.add('icon-swap-in');
        svg.addEventListener('animationend', () => svg.classList.remove('icon-swap-in'), { once: true });
      }

      function showStackToast(msg) {
        const t = document.getElementById('stack-toast');
        if (!t) return;
        t.textContent = msg;
        t.classList.add('visible');
        clearTimeout(window.__toastTimeout);
        window.__toastTimeout = setTimeout(() => {
          t.classList.remove('visible');
        }, 3500);
      }

      ['pointerdown'].forEach(ev => document.addEventListener(ev, e => {
        const r = e.target;
        if (r && r.matches && r.matches('input[type="range"]')) r.classList.add('is-dragging');
      }, true));
      ['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, () => {
        document.querySelectorAll('input[type="range"].is-dragging').forEach(r => r.classList.remove('is-dragging'));
      }, true));
      document.addEventListener('blur', e => {
        if (e.target && e.target.classList) e.target.classList.remove('is-dragging');
      }, true);

      window.toggleWorkStack = function(workId, btnEl) {
        const state = CuratorialStack.toggle(workId);
        const inStack = state === 'added';
        if (btnEl) {
          btnEl.classList.toggle('active', inStack);
          swapStackIcon(btnEl, inStack);
          if (inStack) pulseEl(btnEl);
        }
        const dossierBtn = document.getElementById('artwork-stack-btn');
        if (dossierBtn) {
          dossierBtn.classList.toggle('active', inStack);
          if (inStack) pulseEl(dossierBtn);
          dossierBtn.innerHTML = inStack
            ? `<svg class="icon-swap-in" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg> <span>✓ IN STACK [CLICK TO REMOVE]</span>`
            : `<svg class="icon-swap-in" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg> <span>+ ADD TO CURATORIAL STACK</span>`;
        }
        document.querySelectorAll(`.card-stack-btn[data-work-id="${workId}"]`).forEach(b => {
          b.classList.toggle('active', inStack);
          swapStackIcon(b, inStack);
        });
        showStackToast(inStack ? 'Added to your curatorial stack' : 'Removed from curatorial stack');
      };

      window.findHaikuById = function(hId) {
        if (!hId) return null;
        const cleanId = String(hId).startsWith('haiku:') ? String(hId).slice(6) : String(hId);

        // 1. Check exact match in specimens first (dossier specimens: "01" - "08" or code "BS-1691-A")
        const specimens = window.HAIKU_SPECIMENS || (typeof HAIKU_SPECIMENS !== 'undefined' ? HAIKU_SPECIMENS : []);
        const fromSpecimens = specimens.find(s => s.id === cleanId || s.code === cleanId);
        if (fromSpecimens) {
          return {
            id: fromSpecimens.id,
            stackKey: 'haiku:' + fromSpecimens.id,
            author: fromSpecimens.author,
            year: fromSpecimens.year,
            jp: fromSpecimens.jp,
            en: fromSpecimens.literal || fromSpecimens.en || '',
            romaji: fromSpecimens.romaji,
            notes: fromSpecimens.notes,
            kigo: fromSpecimens.kigo,
            isSpecimen: true
          };
        }

        // 2. Check pool exact match ("001" - "100")
        const pool = window.HAIKU_POOL || [];
        const fromPool = pool.find(h => h.id === cleanId);
        if (fromPool) {
          return {
            ...fromPool,
            stackKey: 'haiku:' + fromPool.id,
            en: fromPool.en || fromPool.literal || ''
          };
        }

        // 3. Fallback: pad numeric ID to 3 digits for pool ONLY if cleanId is purely numeric
        // and did not match any specimen
        if (/^\d{1,3}$/.test(cleanId)) {
          const padded = cleanId.padStart(3, '0');
          const fromPoolPadded = pool.find(h => h.id === padded);
          if (fromPoolPadded) {
            return {
              ...fromPoolPadded,
              stackKey: 'haiku:' + fromPoolPadded.id,
              en: fromPoolPadded.en || fromPoolPadded.literal || ''
            };
          }
        }

        return null;
      };

      window.toggleHaikuStack = function(haikuId, btnEl) {
        const fullKey = haikuId.startsWith('haiku:') ? haikuId : ('haiku:' + haikuId);
        const cleanId = fullKey.slice(6);
        const state = CuratorialStack.toggle(fullKey);
        const inStack = state === 'added';
        if (btnEl) {
          btnEl.classList.toggle('active', inStack);
          swapStackIcon(btnEl, inStack);
          if (inStack) pulseEl(btnEl);
        }
        document.querySelectorAll(`.card-stack-btn[data-haiku-id="${haikuId}"], .card-stack-btn[data-haiku-id="${fullKey}"], .card-stack-btn[data-haiku-id="${cleanId}"]`).forEach(b => {
          b.classList.toggle('active', inStack);
          swapStackIcon(b, inStack);
        });
        showStackToast(inStack ? 'Haiku saved to curatorial stack' : 'Haiku removed from curatorial stack');
      };

      // ============================================================================
      // LIVING MARGINALIA & AUTONOMOUS 6-RIBBON ENGINE (ALL HAIKUS RANDOMIZED)
      // ============================================================================
      const HAIKU_SPECIMENS = [
        {
          id: "01",
          code: "BS-1691-A",
          author: "Matsuo Bashō",
          authorJp: "松尾芭蕉",
          lifespan: "1644–1694",
          year: "1691 (Saga Diary)",
          jp: "麦めしにやつるる恋か猫の妻",
          romaji: "Mugi-meshi ni / yatsururu koi ka / neko no tsuma",
          literal: "Wasting away on coarse barley rice—is it from love, O cat’s wife?",
          notes: "Recorded in Bashō's Saga Diary (嵯峨日記). Unlike pampered court cats fed on fish, this rural stray subsists on rough boiled barley, growing gaunt and hollow-cheeked during the spring mating season.",
          kigo: "猫の妻 (Cat's wife — Spring)",
          pathology: "Malnutrition & unrequited longing"
        },
        {
          id: "02",
          code: "BS-1690-B",
          author: "Matsuo Bashō",
          authorJp: "松尾芭蕉",
          lifespan: "1644–1694",
          year: "c. 1690 (Genroku Era)",
          jp: "猫の恋やむとき閨の朧月",
          romaji: "Neko no koi / yamu toki neya no / oborozuki",
          literal: "When the cat's cries of love finally cease—the hazy moon in the bedchamber.",
          notes: "All night the alley reverberates with desperate feline yowling. At the exact moment the crying stops, an eerie silence floods the room, illuminated only by a blurred, melancholic vernal moon.",
          kigo: "猫の恋 (Cat's love) / 朧月 (Hazy moon)",
          pathology: "Nocturnal exhaustion & sudden acoustic void"
        },
        {
          id: "03",
          code: "IS-1812-A",
          author: "Kobayashi Issa",
          authorJp: "小林一茶",
          lifespan: "1763–1828",
          year: "1812 (Bunka 9)",
          jp: "うかれ猫奇妙に痩せて参りけり",
          romaji: "Ukare-neko / kimyō ni yasete / mairi-keri",
          literal: "The lovesick stray cat—strangely thin and gaunt, comes limping home.",
          notes: "Issa, lifelong chronicler of small, overlooked creatures, observes a wandering tomcat returning after days of absence. The adverb 'kimyō ni' (strangely/uncannily) underscores the skeletal transformation.",
          kigo: "うかれ猫 (Wandering lovesick cat — Spring)",
          pathology: "Extreme weight loss & limping gait"
        },
        {
          id: "04",
          code: "IS-1818-B",
          author: "Kobayashi Issa",
          authorJp: "小林一茶",
          lifespan: "1763–1828",
          year: "c. 1818 (Bunsei Era)",
          jp: "恋猫のぬれつつ帰るあはれさよ",
          romaji: "Koi-neko no / nuretsutsu kaeru / awaresa yo",
          literal: "The pathos of the lovesick cat, returning home soaked through with rain.",
          notes: "Classical 'mono no aware' applied to an alley cat. Matted fur, shivering spine, trudging across wet tatami or mud at dawn after a futile night outdoors.",
          kigo: "恋猫 (Lovesick cat — Spring)",
          pathology: "Hypothermia & damp dejection"
        },
        {
          id: "05",
          code: "MS-1896-A",
          author: "Masaoka Shiki",
          authorJp: "正岡子規",
          lifespan: "1867–1902",
          year: "1896 (Meiji 29)",
          jp: "恋猫の眼ばかりに痩せにけり",
          romaji: "Koi-neko no / manako bakari ni / yase ni keri",
          literal: "The lovesick cat has wasted away until only its eyes remain.",
          notes: "Written while Shiki himself was bedridden with tuberculosis. The hyper-realist 'shasei' (sketch from life) reduces the starving animal to two enormous, feverish orbs floating in a shrunken skull.",
          kigo: "恋猫 (Lovesick cat — Spring)",
          pathology: "Ocular prominence via severe emaciation"
        },
        {
          id: "06",
          code: "YB-1774-A",
          author: "Yosa Buson",
          authorJp: "与謝蕪村",
          lifespan: "1716–1784",
          year: "c. 1774 (An'ei Era)",
          jp: "恋わたる猫のあわれや春の暮",
          romaji: "Koi-wataru / neko no aware ya / haru no kure",
          literal: "How pitiful, the cat wandering across the roofs in love—spring dusk.",
          notes: "Buson brings a painter's composition: as twilight deepens over Kyoto tiles, a solitary silhouette crosses the ridgepole, crying into the gathering cold.",
          kigo: "春の暮 (Spring evening)",
          pathology: "Twilight disorientation & solitude"
        },
        {
          id: "07",
          code: "TK-1689-A",
          author: "Takarai Kikaku",
          authorJp: "宝井其角",
          lifespan: "1661–1707",
          year: "c. 1689 (Genroku Era)",
          jp: "猫の恋初手から鳴いて哀れなり",
          romaji: "Neko no koi / shote kara naite / aware nari",
          literal: "Cat's love: crying out in grief from the very beginning, how pitiful.",
          notes: "Bashō's foremost disciple notes that unlike human romance—which begins in sweetness and ends in tears—the alley cat's courtship starts from its very first breath as an agonizing wail.",
          kigo: "猫の恋 (Cat's love — Spring)",
          pathology: "Congenital vocal anguish"
        },
        {
          id: "08",
          code: "NS-1908-A",
          author: "Natsume Sōseki",
          authorJp: "夏目漱石",
          lifespan: "1867–1916",
          year: "c. 1908 (Meiji 41)",
          jp: "恋猫の眼ばかり光る闇夜かな",
          romaji: "Koi-neko no / me bakari hikaru / yamiyo kana",
          literal: "Only the eyes of the lovesick cat gleam in the pitch-dark night.",
          notes: "By the author of 'I Am a Cat' (Wagahai wa Neko de Aru). After the death of his family's nameless stray cat in 1908, Sōseki wrote solemn memorials and dark nocturnal haiku where the cat dissolves into pure phosphorescent gaze.",
          kigo: "恋猫 (Lovesick cat — Spring)",
          pathology: "Nocturnal tapetum lucidum reflection"
        }
      ];

      const RAIN_GLYPHS = ['·', '∶', '⋮', '░', '▒', '│', '¦', ' ', ' '];
      const BRAILLE_GLITCH = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏', '∷', '※'];
      const CAT_MOTIFS = ['(=^‥^=)', '◉_◉', '🐾·🐾·🐾', '╱|、猫', '( ◉ )', 'ミ◦_◦彡'];

      let currentMode = 'still'; // static haikus with a gentle drift; rain/prowl are opt-in
      try { const m = localStorage.getItem('felis_margin_mode'); if (/^(still|calm|rain|prowl)$/.test(m || '')) currentMode = m; } catch (e) {}
      let lastScrollAt = -1e9; // glyph swaps pause while the page scrolls
      let mutationRate = 0.01;
      let parallaxMultiplier = 1.0;
      let tick = 0;
      let marginScrollVelocity = 0;
      let lastMarginScrollY = window.pageYOffset || document.documentElement.scrollTop;

      let catApparition = { active: false, state: null, startIndex: 0, chars: [], ttl: 0 };

      const HAIKU_POOL = /* __INJECT_HAIKU_POOL__ */ [];

      function pickRandomHaikus(pool, count) {
        const copy = [...pool];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return typeof count === 'number' ? copy.slice(0, count) : copy;
      }

      function buildRibbonSegment(h) {
        return `···│░░░ ${h.jp} 〔${h.authorJp}〕 ░░░│···`;
      }

      const RIBBON_DOM_IDS = [
        'ribbon-l-outer',
        'ribbon-l-main',
        'ribbon-l-inner',
        'ribbon-r-inner',
        'ribbon-r-main',
        'ribbon-r-outer'
      ];

      const RIBBON_BASE_SPECS = [
        { side: 'left',  speed: 0.22 },
        { side: 'left',  speed: 0.14 },
        { side: 'left',  speed: 0.09 },
        { side: 'right', speed: 0.20 },
        { side: 'right', speed: 0.13 },
        { side: 'right', speed: 0.08 }
      ];

      let activeMarginHaikus = [];
      const RIBBON_CONFIGS = [];

      function randomizeRibbonHaikus() {
        // Shuffle the entire HAIKU_POOL every time so all 100 haikus are randomized
        const allShuffled = pickRandomHaikus(HAIKU_POOL, HAIKU_POOL.length);
        activeMarginHaikus = allShuffled;
        window.activeMarginHaikus = activeMarginHaikus;

        RIBBON_CONFIGS.length = 0;
        const perRibbon = Math.ceil(allShuffled.length / RIBBON_BASE_SPECS.length);

        RIBBON_BASE_SPECS.forEach((spec, rIdx) => {
          let slice = allShuffled.slice(rIdx * perRibbon, (rIdx + 1) * perRibbon);
          if (slice.length < 8) {
            slice = slice.concat(pickRandomHaikus(HAIKU_POOL, 8 - slice.length));
          }
          // Repeat the randomized sequence twice so the 50% scrollHeight loop is seamless
          const ribbonHaikus = slice.concat(slice);
          const baseText = ribbonHaikus.map(h => buildRibbonSegment(h)).join('');
          RIBBON_CONFIGS.push({
            ...spec,
            id: `ribbon-${rIdx}`,
            domId: RIBBON_DOM_IDS[rIdx],
            phase: rIdx * 1.05,
            haikus: ribbonHaikus,
            baseText
          });
        });
      }

      window.HAIKU_POOL = HAIKU_POOL;

      // Poet biographies for #/poet/<slug> (data/poets.json, injected at build time).
      // `author` matches the haiku pool's author field, so any haiku leads to its poet.
      const POETS = /* __INJECT_POETS__ */ [];
      const poetForAuthor = name => POETS.find(p => p.author === name || p.name === name) || null;
      window.POETS = POETS;
      window.pickRandomHaikus = pickRandomHaikus;
      window.RIBBON_CONFIGS = RIBBON_CONFIGS;
      window.buildRibbonSegment = buildRibbonSegment;
      window.randomizeRibbonHaikus = randomizeRibbonHaikus;

      const ribbonStateMap = {};
      const ribbonStates = [];

      const MARGIN_OVERSCAN = 160; // px animated above/below the viewport
      let marginViewportH = window.innerHeight;

      function lowerBound(arr, v) {
        let lo = 0, hi = arr.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
        return lo;
      }

      function setCell(state, cell, ch) {
        if (cell.currentChar === ch) return false;
        cell.currentChar = ch;
        cell.el.textContent = ch;
        if (ch === cell.baseChar) state.dirty.delete(cell); else state.dirty.add(cell);
        return true;
      }

      function restoreRibbon(state) {
        state.dirty.forEach(cell => { cell.currentChar = cell.baseChar; cell.el.textContent = cell.baseChar; });
        state.dirty.clear();
      }

      // One layout read for everything the loop needs; redone on resize and when fonts arrive
      function measureRibbons() {
        marginViewportH = window.innerHeight;
        ribbonStates.forEach(state => {
          state.visible = state.el.getClientRects().length > 0; // false for ribbons hidden by CSS
          if (!state.visible) return;
          state.periodH = Math.max(240, state.el.scrollHeight / 2);
          // Cells are offset within their haiku segment (contain: layout makes it the offsetParent)
          state.offsets = state.cells.map(c => {
            const seg = c.el.parentElement;
            return c.el.offsetTop + (seg && seg.classList.contains('ribbon-seg') ? seg.offsetTop : 0);
          });
        });
      }
      let marginMeasureTimer = 0;
      window.addEventListener('resize', () => {
        clearTimeout(marginMeasureTimer);
        marginMeasureTimer = setTimeout(measureRibbons, 150);
      }, { passive: true });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureRibbons);
      // The kanji face arrives late (non-blocking stylesheet): re-measure once it has loaded
      if (document.fonts && document.fonts.addEventListener) {
        document.fonts.addEventListener('loadingdone', () => {
          clearTimeout(marginMeasureTimer);
          marginMeasureTimer = setTimeout(measureRibbons, 100);
        });
      }

      function initMarginRibbons() {
        randomizeRibbonHaikus();
        ribbonStates.length = 0;

        RIBBON_CONFIGS.forEach((cfg, rIdx) => {
          const track = document.getElementById(cfg.domId) || document.getElementById(cfg.id);
          if (!track) return;
          track.innerHTML = '';
          const cells = [];
          const frag = document.createDocumentFragment();
          let cIdx = 0;

          cfg.haikus.forEach((h, slotIdx) => {
            const seg = buildRibbonSegment(h);
            const chars = Array.from(seg);
            // One block per haiku: a glyph swap re-lays out ~40 glyphs, not the whole ribbon
            const segEl = document.createElement('span');
            segEl.className = 'ribbon-seg';
            frag.appendChild(segEl);
            chars.forEach((ch) => {
              const span = document.createElement('span');
              const isKanji = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/.test(ch);
              span.className = isKanji ? 'm-char glyph-cell kanji-char' : 'm-char glyph-cell';
              span.textContent = ch;
              span.dataset.ribbon = rIdx;
              span.dataset.slot = slotIdx;
              span.dataset.cellIdx = cIdx;
              span.dataset.haikuId = h.id;
              segEl.appendChild(span);

              cells.push({
                baseChar: ch,
                currentChar: ch,
                isKanji: isKanji,
                slot: slotIdx,
                ribbon: rIdx,
                el: span
              });
              cIdx++;
            });
          });

          track.appendChild(frag);
          const stateObj = { config: cfg, el: track, cells, dirty: new Set(), visible: true, offsets: [], periodH: 480, visStart: 0, visEnd: 0 };
          ribbonStates.push(stateObj);
          ribbonStateMap[cfg.id] = stateObj;
          ribbonStateMap[cfg.domId] = stateObj;
        });
        measureRibbons();
      }

      function triggerCatEventInMargin() {
        if (catApparition.active) endCatApparition();
        const candidates = ribbonStates.filter(s => s.visible && s.config.domId.endsWith('-main'));
        if (!candidates.length) return;
        const state = candidates[Math.floor(Math.random() * candidates.length)];
        // Array.from keeps 🐾 as one glyph (string indexing split it into broken halves)
        const chars = Array.from(CAT_MOTIFS[Math.floor(Math.random() * CAT_MOTIFS.length)]);
        const lo = state.visStart + 12; // appear on screen, not in the overscan band
        const hi = Math.max(lo + 1, state.visEnd - 12 - chars.length);
        const startIndex = Math.min(state.cells.length - chars.length, lo + Math.floor(Math.random() * (hi - lo)));
        catApparition = { active: true, state, startIndex, chars, ttl: 110 };
        chars.forEach((_, k) => { const c = state.cells[startIndex + k]; if (c) c.el.classList.add('cat-active'); });
      }

      function endCatApparition() {
        const { state, startIndex, chars } = catApparition;
        if (state) chars.forEach((_, k) => {
          const c = state.cells[startIndex + k];
          if (c) { c.el.classList.remove('cat-active'); setCell(state, c, c.baseChar); }
        });
        catApparition = { active: false, state: null, startIndex: 0, chars: [], ttl: 0 };
      }

      // The glyph logic keeps its 60 Hz tick clock (same rhythm on 60/120/144 Hz screens) but
      // glyphs are written to the DOM every 2nd tick (30 Hz) and each pass covers both ticks,
      // so the effect looks the same at half the layout/paint cost. The drift transform is
      // written every display frame so it stays smooth.
      const MARGIN_STEP_MS = 1000 / 60;
      const GLYPH_PASS_TICKS = 2;
      let marginClock = 0;
      let marginLastNow = 0;
      let lastGlyphTick = 0;
      const chanceOver = (p, n) => 1 - Math.pow(1 - p, n); // chance of >=1 hit in n ticks
      // Glyph writes per ribbon per pass. Fast scrolling raises the glitch rate exactly when
      // frames matter most; the cap keeps it to a fixed cost. The scan start rotates so every
      // part of the column still gets its turn.
      const GLYPH_WRITE_BUDGET = 14;

      function animateMargins(now) {
        requestAnimationFrame(animateMargins);
        if (now === undefined) return;
        if (!marginLastNow) marginLastNow = now;
        marginClock += Math.min(now - marginLastNow, 100); // no catch-up burst after a stall
        marginLastNow = now;
        const smoothTick = marginClock / MARGIN_STEP_MS;
        const prevTick = tick;
        tick = Math.floor(smoothTick);
        if (tick !== prevTick) {
          marginScrollVelocity *= Math.pow(0.91, tick - prevTick);
          if (marginScrollVelocity < 0.05) marginScrollVelocity = 0;
        }
        // Scrolling gets the whole frame budget: glyphs hold still until 300 ms after it stops
        const scrolling = now - lastScrollAt < 300;
        if (scrolling) lastGlyphTick = tick;
        const n = Math.min(tick - lastGlyphTick, 6); // logic ticks this glyph pass covers
        const glyphPass = n >= GLYPH_PASS_TICKS;
        if (glyphPass) lastGlyphTick = tick;

        if (!glyphPass) {
          // transform pass only
        } else if (catApparition.active) {
          const before = catApparition.ttl;
          catApparition.ttl -= n;
          if (before > 55 && catApparition.ttl <= 55 && catApparition.ttl > 42) catApparition.chars = catApparition.chars.map(c => (c === '◉' ? '─' : c));
          else if (before > 42 && catApparition.ttl <= 42) catApparition.chars = catApparition.chars.map(c => (c === '─' ? '◉' : c));
          if (catApparition.ttl <= 0) endCatApparition();
        } else if (currentMode !== 'still') {
          const prowlChance = currentMode === 'prowl' ? 0.022 : (currentMode === 'calm' ? 0.0015 : 0.004);
          if (Math.random() < chanceOver(prowlChance * mutationRate, n)) triggerCatEventInMargin();
        }

        const scrollY = window.scrollY || 0;
        const amp = (currentMode === 'calm' || currentMode === 'still') ? 4 : 9;
        const rateFactor = currentMode === 'calm' ? mutationRate * 0.45 : mutationRate * 0.9;
        const scrambleThreshold = chanceOver(Math.min(1, marginScrollVelocity * 0.005 + (currentMode === 'rain' ? 0.003 : 0.001) * mutationRate), n);
        const restoreChance = chanceOver(0.03, n);
        const restoreKanjiChance = chanceOver(0.18, n);

        for (const state of ribbonStates) {
          if (!state.visible) continue;
          const { config, el, cells, offsets } = state;

          const breath = Math.sin(smoothTick * 0.022 + config.phase) * amp;
          const rawY = scrollY * config.speed * parallaxMultiplier - breath;
          const P = state.periodH;
          const wrappedY = -(((rawY % P) + P) % P);
          el.style.transform = `translate3d(0, ${wrappedY.toFixed(2)}px, 0)`;
          if (!glyphPass) continue;

          // Only glyphs inside the viewport (+ overscan) are touched
          const top = -wrappedY - MARGIN_OVERSCAN;
          const start = lowerBound(offsets, top);
          const end = lowerBound(offsets, top + marginViewportH + 2 * MARGIN_OVERSCAN);
          state.visStart = start;
          state.visEnd = end;

          const isCat = catApparition.active && catApparition.state === state;
          const catLo = isCat ? catApparition.startIndex : -1;
          const catHi = isCat ? catLo + catApparition.chars.length : -1;
          if (isCat) {
            for (let k = 0; k < catApparition.chars.length; k++) {
              const c = cells[catLo + k];
              if (c) setCell(state, c, catApparition.chars[k]);
            }
          }

          if (currentMode === 'still') {
            if (!isCat && state.dirty.size) restoreRibbon(state);
            continue;
          }

          const span = end - start;
          const rot = span > 0 ? (tick * 17) % span : 0;
          let writes = 0;
          for (let j = 0; j < span && writes < GLYPH_WRITE_BUDGET; j++) {
            const i = start + ((j + rot) % span);
            if (i >= catLo && i < catHi) continue;
            const cell = cells[i];
            if (!cell.isKanji) {
              const wave = Math.sin(tick * 0.045 - i * 0.28 + config.phase) + Math.cos(tick * 0.019 + i * 0.13);
              if (wave > 1.35 - rateFactor && (tick + i) % 6 < n) {
                let next;
                if (marginScrollVelocity > 18) next = BRAILLE_GLITCH[(tick + i) % BRAILLE_GLITCH.length];
                else if (currentMode === 'prowl' && Math.random() < 0.08) next = '🐾';
                else next = RAIN_GLYPHS[Math.abs(Math.floor(wave * 4 + tick * 0.08)) % RAIN_GLYPHS.length];
                writes += setCell(state, cell, next);
              } else if (cell.currentChar !== cell.baseChar && Math.random() < restoreChance) {
                writes += setCell(state, cell, cell.baseChar);
              }
            } else if (Math.random() < scrambleThreshold) {
              writes += setCell(state, cell, BRAILLE_GLITCH[Math.floor(Math.random() * BRAILLE_GLITCH.length)]);
            } else if (cell.currentChar !== cell.baseChar && Math.random() < restoreKanjiChance) {
              writes += setCell(state, cell, cell.baseChar);
            }
          }
        }
      }

      function refreshNotepadMargins() {
        initMarginRibbons();
      }

      window.addEventListener('scroll', () => {
        const currentY = window.pageYOffset || document.documentElement.scrollTop;
        const delta = Math.abs(currentY - lastMarginScrollY);
        marginScrollVelocity = Math.min(marginScrollVelocity + delta * 0.35, 65);
        lastMarginScrollY = currentY;
        lastScrollAt = performance.now();
      }, { passive: true });

      // Mobile smart header: hides while reading down, returns on any upward scroll.
      // The era strip is positioned off --hdr-top, so it glides up into the header's place.
      (function initSmartHeader() {
        const root = document.documentElement;
        const header = document.querySelector('header.site-header');
        const mobileMq = window.matchMedia('(max-width: 899px)');
        const DEAD_ZONE = 10;          // px of travel before direction counts (kills jitter)
        let lastY = window.pageYOffset;
        let ticking = false;

        const setHidden = (hide) => root.classList.toggle('header-hidden', hide);
        const mustStayVisible = () =>
          !mobileMq.matches ||
          document.body.classList.contains('intro-locked') ||
          (haikuSettingsDrawer && !haikuSettingsDrawer.classList.contains('hidden'));

        function update() {
          ticking = false;
          const y = Math.max(0, window.pageYOffset);   // iOS rubber-banding can go negative
          const dy = y - lastY;
          if (mustStayVisible() || y < 56) { setHidden(false); lastY = y; return; }
          if (Math.abs(dy) < DEAD_ZONE) return;
          setHidden(dy > 0);
          lastY = y;
        }

        window.addEventListener('scroll', () => {
          if (!ticking) { ticking = true; requestAnimationFrame(update); }
        }, { passive: true });
        window.addEventListener('hashchange', () => { setHidden(false); lastY = window.pageYOffset; });
        mobileMq.addEventListener('change', () => setHidden(false));
        if (header) header.addEventListener('focusin', () => setHidden(false));
      })();

      // Minimalist Hover Tooltip (Desktop) + Touch Modal (Mobile)
      const tooltip = document.getElementById('margin-tooltip');
      const touchBackdrop = document.getElementById('haiku-touch-backdrop');
      const ttAuthor = document.getElementById('tt-author');
      const ttYear   = document.getElementById('tt-year');
      const ttJp     = document.getElementById('tt-jp');
      const ttEn     = document.getElementById('tt-en');
      const ttRomaji = document.getElementById('tt-romaji');
      let isTouchHaikuOpen = false;

      function populateTooltipFromHaiku(h) {
        if (!h) return false;
        if (ttAuthor) {
          ttAuthor.textContent = h.author || '';
          // The poet's name leads to their page (pin the tooltip on desktop to reach it)
          const poet = poetForAuthor(h.author);
          if (poet) {
            ttAuthor.setAttribute('href', '#/poet/' + poet.slug);
            ttAuthor.removeAttribute('aria-disabled');
            ttAuthor.title = 'About ' + poet.name;
          } else {
            ttAuthor.removeAttribute('href');
            ttAuthor.setAttribute('aria-disabled', 'true');
            ttAuthor.removeAttribute('title');
          }
        }
        const ttLifespan = document.getElementById('tt-lifespan');
        if (ttLifespan) ttLifespan.textContent = h.lifespan ? '(' + h.lifespan + ')' : '';
        if (ttYear) ttYear.textContent = h.year || '';
        if (ttJp) ttJp.textContent = h.jp || '';
        if (ttRomaji) ttRomaji.textContent = h.romaji || '';
        if (ttEn) ttEn.textContent = h.en || h.literal || '';
        return true;
      }

      function findHaikuFromCellOrPoint(targetEl, clientY) {
        let cell = targetEl && targetEl.closest ? targetEl.closest('.m-char') : null;
        if (!cell && targetEl && targetEl.closest) {
          const container = targetEl.closest('.living-margin-container');
          if (container) {
            const mainRibbon = container.querySelector('.tategaki-ribbon:not(.ascii-col)') || container.querySelector('.tategaki-ribbon');
            if (mainRibbon) {
              const chars = mainRibbon.querySelectorAll('.m-char');
              let bestDist = Infinity;
              chars.forEach(chEl => {
                const r = chEl.getBoundingClientRect();
                const midY = (r.top + r.bottom) / 2;
                const dist = Math.abs(midY - clientY);
                if (dist < bestDist) {
                  bestDist = dist;
                  cell = chEl;
                }
              });
            }
          }
        }
        if (!cell) return null;
        const rIdx = Number(cell.dataset.ribbon);
        const slot = Number(cell.dataset.slot);
        const cfg = RIBBON_CONFIGS[rIdx];
        if (!cfg || !cfg.haikus) return null;
        return cfg.haikus[slot] || cfg.haikus[0] || null;
      }

      function openTouchHaikuModal(h) {
        if (!populateTooltipFromHaiku(h) || !tooltip) return;
        isTouchHaikuOpen = true;
        tooltip.style.left = '';
        tooltip.style.top = '';
        tooltip.classList.remove('hidden');
        tooltip.classList.add('visible', 'touch-modal-active');
        tooltip.setAttribute('aria-hidden', 'false');
        document.body.classList.add('haiku-touch-open');
        if (touchBackdrop) {
          touchBackdrop.classList.add('active');
        }
      }

      function closeTouchHaikuModal() {
        if (!isTouchHaikuOpen) return;
        isTouchHaikuOpen = false;
        if (tooltip) {
          tooltip.classList.remove('visible', 'touch-modal-active');
          tooltip.classList.add('hidden');
          tooltip.setAttribute('aria-hidden', 'true');
        }
        document.body.classList.remove('haiku-touch-open');
        if (touchBackdrop) {
          touchBackdrop.classList.remove('active');
        }
      }

      // Mobile / Touch handling on the left & right haiku ribbons
      let ribbonTouchStartX = 0;
      let ribbonTouchStartY = 0;
      document.querySelectorAll('.living-margin-container').forEach(marginEl => {
        marginEl.addEventListener('touchstart', (e) => {
          if (e.touches && e.touches.length > 0) {
            ribbonTouchStartX = e.touches[0].clientX;
            ribbonTouchStartY = e.touches[0].clientY;
          }
        }, { passive: true });

        marginEl.addEventListener('touchend', (e) => {
          if (!e.changedTouches || e.changedTouches.length === 0) return;
          const touch = e.changedTouches[0];
          const dist = Math.hypot(touch.clientX - ribbonTouchStartX, touch.clientY - ribbonTouchStartY);
          if (dist < 18) {
            e.preventDefault();
            e.stopPropagation();
            const hitEl = document.elementFromPoint(touch.clientX, touch.clientY) || e.target;
            const h = findHaikuFromCellOrPoint(hitEl, touch.clientY);
            if (h) openTouchHaikuModal(h);
          }
        }, { passive: false });

        marginEl.addEventListener('click', (e) => {
          if (window.innerWidth <= 991 || !isDesktopPointer) {
            e.preventDefault();
            e.stopPropagation();
            const h = findHaikuFromCellOrPoint(e.target, e.clientY);
            if (h) openTouchHaikuModal(h);
          }
        });
      });

      // Tapping back on the main body (or backdrop / tooltip) closes the haiku modal
      if (touchBackdrop) {
        touchBackdrop.addEventListener('touchstart', (e) => {
          if (isTouchHaikuOpen) {
            e.preventDefault();
            e.stopPropagation();
            closeTouchHaikuModal();
          }
        }, { passive: false });
        touchBackdrop.addEventListener('click', (e) => {
          if (isTouchHaikuOpen) {
            e.preventDefault();
            e.stopPropagation();
            closeTouchHaikuModal();
          }
        });
      }
      if (tooltip) {
        tooltip.addEventListener('click', (e) => {
          // The poet's name is a real link: let it navigate (navigate() closes the card)
          if (e.target.closest && e.target.closest('#tt-author[href]')) return;
          if (isTouchHaikuOpen) closeTouchHaikuModal();
        });
      }
      if (appRoot) {
        appRoot.addEventListener('click', (e) => {
          if (isTouchHaikuOpen) {
            e.preventDefault();
            e.stopPropagation();
            closeTouchHaikuModal();
          }
        }, true);
      }

      // Desktop Hover Tooltip. A click on a margin haiku pins its card in place, so the pointer
      // can travel to it and follow the poet's name; a click elsewhere or Esc lets it go.
      let ttPinned = false;
      // After a navigation the new page renders under a resting pointer, and the browser fires
      // mouseover at it; hover cards wait until the mouse has actually moved.
      let ttQuietAt = null;
      document.addEventListener('mousemove', (e) => {
        if (ttQuietAt && Math.hypot(e.clientX - ttQuietAt.x, e.clientY - ttQuietAt.y) > 4) ttQuietAt = null;
      }, true);
      function placeTooltip(x, y) {
        const offsetX = x < window.innerWidth / 2 ? x + 24 : x - 300;
        const offsetY = Math.min(window.innerHeight - 140, Math.max(16, y - 30));
        tooltip.style.left = `${Math.max(12, offsetX)}px`;
        tooltip.style.top = `${offsetY}px`;
      }
      function unpinMarginTooltip() {
        if (window.lastPointer) ttQuietAt = { ...window.lastPointer };
        if (tooltip && !isTouchHaikuOpen) {
          tooltip.classList.remove('visible');
          tooltip.classList.add('hidden');
        }
        if (!ttPinned || !tooltip) return;
        ttPinned = false;
        tooltip.classList.remove('pinned', 'visible');
        tooltip.classList.add('hidden');
        tooltip.setAttribute('aria-hidden', 'true');
      }
      document.addEventListener('click', (e) => {
        if (isTouchHaikuOpen || !isDesktopPointer || window.innerWidth <= 991 || !tooltip) return;
        if (e.target.closest && e.target.closest('#margin-tooltip')) return;
        const cell = e.target.closest ? e.target.closest('.m-char') : null;
        const cfg = cell && RIBBON_CONFIGS[Number(cell.dataset.ribbon)];
        const h = cfg && cfg.haikus && cfg.haikus[Number(cell.dataset.slot)];
        if (h && populateTooltipFromHaiku(h)) {
          ttPinned = true;
          tooltip.classList.remove('hidden', 'touch-modal-active');
          tooltip.classList.add('visible', 'pinned');
          tooltip.setAttribute('aria-hidden', 'false');
          placeTooltip(e.clientX, e.clientY);
        } else {
          unpinMarginTooltip();
        }
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') unpinMarginTooltip(); });
      document.addEventListener('pointermove', (e) => { window.lastPointer = { x: e.clientX, y: e.clientY }; }, { passive: true, capture: true });

      document.addEventListener('mouseover', (e) => {
        if (isTouchHaikuOpen || !isDesktopPointer || ttPinned) return;
        if (ttQuietAt && Math.hypot(e.clientX - ttQuietAt.x, e.clientY - ttQuietAt.y) <= 4) return;
        const cell = e.target.closest ? e.target.closest('.m-char') : null;
        if (!cell) {
          if (tooltip) {
            tooltip.classList.remove('visible');
            tooltip.classList.add('hidden');
          }
          return;
        }
        const rIdx = Number(cell.dataset.ribbon);
        const slot = Number(cell.dataset.slot);
        const cfg = RIBBON_CONFIGS[rIdx];
        if (!cfg || !cfg.haikus) return;
        const h = cfg.haikus[slot];
        if (!populateTooltipFromHaiku(h)) return;

        if (tooltip) {
          tooltip.classList.remove('hidden', 'touch-modal-active');
          tooltip.classList.add('visible');
        }
      });

      document.addEventListener('mousemove', (e) => {
        if (isTouchHaikuOpen || !isDesktopPointer || ttPinned) return;
        if (!tooltip || !tooltip.classList.contains('visible')) return;
        placeTooltip(e.clientX, e.clientY);
      });

      document.addEventListener('mouseleave', () => {
        if (isTouchHaikuOpen || ttPinned) return;
        if (tooltip) {
          tooltip.classList.remove('visible');
          tooltip.classList.add('hidden');
        }
      });

      // Settings Drawer Bindings
      const haikuSettingsBtn = document.getElementById('haiku-settings-btn');
      const haikuSettingsDrawer = document.getElementById('haiku-settings-drawer');
      const closeSettingsBtn = document.getElementById('close-settings-btn');

      function closeHaikuDrawer() {
        if (!haikuSettingsDrawer) return;
        haikuSettingsDrawer.classList.add('hidden');
        if (haikuSettingsBtn) {
          haikuSettingsBtn.setAttribute('aria-expanded', 'false');
          haikuSettingsBtn.classList.remove('active');
        }
      }

      if (haikuSettingsBtn && haikuSettingsDrawer) {
        haikuSettingsBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isHidden = haikuSettingsDrawer.classList.toggle('hidden');
          haikuSettingsBtn.setAttribute('aria-expanded', String(!isHidden));
          haikuSettingsBtn.classList.toggle('active', !isHidden);
        });
        if (closeSettingsBtn) {
          closeSettingsBtn.addEventListener('click', closeHaikuDrawer);
        }
      }

      const modeButtons = document.querySelectorAll('.mode-buttons-group .mode-btn, .mode-btn');
      let nyaaAudio = null;
      function playNyaaSound() {
        try {
          if (!nyaaAudio) {
            nyaaAudio = new Audio('assets/audio/nyaa-3_rhsqpi3v2.mp3');
          }
          nyaaAudio.volume = 0.55;
          nyaaAudio.currentTime = 0;
          nyaaAudio.play().catch(err => console.warn('Nyaa audio play exception:', err));
        } catch (e) {
          console.warn('Could not play nyaa audio:', e);
        }
      }

      modeButtons.forEach(b => b.classList.toggle('active', b.getAttribute('data-mode') === currentMode));
      modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          playNyaaSound();
          currentMode = btn.getAttribute('data-mode');
          try { localStorage.setItem('felis_margin_mode', currentMode); } catch (e) {}
          modeButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (currentMode === 'prowl') {
            triggerCatEventInMargin();
          }
        });
      });

      const parallaxSlider = document.getElementById('haiku-parallax-slider');
      const parallaxVal = document.getElementById('haiku-parallax-val');
      if (parallaxSlider) {
        parallaxSlider.addEventListener('input', (e) => {
          const val = parseInt(e.target.value, 10);
          parallaxMultiplier = val / 100;
          if (parallaxVal) parallaxVal.textContent = `${parallaxMultiplier.toFixed(1)}x`;
        });
      }

      const opacitySlider = document.getElementById('haiku-opacity-slider');
      const opacityVal = document.getElementById('haiku-opacity-val');
      if (opacitySlider) {
        opacitySlider.addEventListener('input', (e) => {
          const val = parseInt(e.target.value, 10);
          document.documentElement.style.setProperty('--margin-opacity', (val / 100).toFixed(2));
          if (opacityVal) opacityVal.textContent = `${val}%`;
        });
      }

      const mutationSlider = document.getElementById('haiku-mutation-slider');
      const mutationVal = document.getElementById('haiku-mutation-val');
      if (mutationSlider) {
        mutationSlider.addEventListener('input', (e) => {
          const val = parseInt(e.target.value, 10);
          mutationRate = val / 100;
          if (mutationVal) mutationVal.textContent = `${val}%`;
        });
      }

      function navigate() {
        closeTouchHaikuModal();
        unpinMarginTooltip();
        if (window.activePoetCleanup) {
          window.activePoetCleanup.abort();
          window.activePoetCleanup = null;
        }
        const currentY = window.scrollY;
        if (lastRoute) {
          scrollMemory.set(lastRoute, currentY);
        }

        const route = getRoute();
        updateNavActive(route.page);

        if (activeLoupeInstance) {
          activeLoupeInstance.destroy();
          activeLoupeInstance = null;
        }
        if (window.currentArtworkKeyHandler) {
          window.removeEventListener('keydown', window.currentArtworkKeyHandler);
          window.currentArtworkKeyHandler = null;
        }
        if (window.activeTimelineObservers) {
          window.activeTimelineObservers.forEach(o => o.disconnect());
          window.activeTimelineObservers = null;
        }
        tilesResizeObserver?.disconnect();

        if (route.page === 'timeline') {
          document.documentElement.setAttribute('data-route', 'timeline');
        } else {
          document.documentElement.removeAttribute('data-route');
        }

        CuratorialStack.updateBadge();

        switch (route.page) {
          case 'timeline':
            renderTimelineView();
            break;
          case 'categories':
            renderCategoriesView(route.query);
            break;
          case 'category':
            renderCategoryDetailView(route.param, route.query);
            break;
          case 'work':
            renderArtworkDetailView(route.param);
            break;
          case 'stack':
            renderStackView();
            break;
          case 'dossier':
            renderDossierView(route.query);
            break;
          case 'poet':
            renderPoetView(route.param);
            break;
          default:
            renderTimelineView();
            break;
        }

        if (scrollMemory.has(route.raw) && route.page !== 'work') {
          window.scrollTo({ top: scrollMemory.get(route.raw), behavior: 'instant' });
        } else {
          window.scrollTo(0, 0);
        }
        requestAnimationFrame(() => window.initCardSliders());
        lastRoute = route.raw;
        document.documentElement.classList.add('has-navigated');
      }

      function setupMiddleplaneTimelineScroll() {
        if (window.innerWidth < 900) return;
        // Scroll-driven CSS animation handles it on the compositor (see .timeline-card)
        if (window.CSS && CSS.supports('animation-timeline: view()')) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        // Thresholds 0, 0.025 … 0.45: the browser reports visibility; no measuring on scroll
        const steps = Array.from({ length: 19 }, (_, i) => i * 0.025);
        const io = new IntersectionObserver(entries => {
          for (const e of entries) {
            const card = e.target;
            const p = e.intersectionRatio;
            if (p >= 0.45) {
              card.style.filter = '';
              card.style.opacity = '';
            } else {
              const norm = (0.45 - p) / 0.45;
              card.style.filter = `blur(${(norm * norm * 2.4).toFixed(2)}px)`;
              card.style.opacity = (1 - norm * 0.32).toFixed(2);
            }
          }
        }, { threshold: steps });
        document.querySelectorAll('.timeline-card').forEach(c => io.observe(c));
        (window.activeTimelineObservers ||= []).push(io);
      }

      let activeStackTab = 'all'; // 'all', 'works', 'haikus'

      function renderStackView() {
        const ids = CuratorialStack.getIds();
        const workIds = CuratorialStack.getWorkIds ? CuratorialStack.getWorkIds() : ids.filter(id => !id.startsWith('haiku:'));
        const haikuIds = CuratorialStack.getHaikuIds ? CuratorialStack.getHaikuIds() : ids.filter(id => id.startsWith('haiku:'));

        const stackWorks = workIds.map(id => artworkSlugMap.get(id)).filter(Boolean);
        const stackHaikus = haikuIds.map(storedKey => {
          const h = window.findHaikuById(storedKey);
          if (!h) return null;
          return {
            ...h,
            _storedKey: storedKey
          };
        }).filter(Boolean);
        const totalCount = stackWorks.length + stackHaikus.length;

        let html = `
          <div class="stack-page-view">
          <div class="stack-header-section">
            <span class="inv-stamp">CURATORIAL ARCHIVE</span>
            <h1 class="stack-primary-title">Curatorial Stack</h1>
            <p class="stack-subtitle">The artworks and haikus you've saved. They stay in this browser, just for you.</p>
            <div class="stack-actions-bar">
              <span class="fabric-tag">${totalCount} ITEMS IN STACK</span>
              <span class="fabric-tag">${stackWorks.length} ARTWORKS</span>
              <span class="fabric-tag">${stackHaikus.length} HAIKUS</span>
              ${totalCount > 0 ? `
                <button class="clear-stack-btn" id="clear-stack-btn">CLEAR ENTIRE STACK</button>
              ` : ''}
            </div>
            <div class="stack-tabs-row">
              <button class="stack-tab-btn ${activeStackTab === 'all' ? 'active' : ''}" data-tab="all">ALL [${totalCount}]</button>
              <button class="stack-tab-btn ${activeStackTab === 'works' ? 'active' : ''}" data-tab="works">ARTWORKS [${stackWorks.length}]</button>
              <button class="stack-tab-btn ${activeStackTab === 'haikus' ? 'active' : ''}" data-tab="haikus">HAIKUS [${stackHaikus.length}]</button>
            </div>
          </div>
        `;

        if (totalCount === 0) {
          html += `
            <div class="stack-empty-state">
              <div class="stack-empty-stamp">[ 0 ITEMS SAVED ]</div>
              <h2>Your curatorial stack is empty</h2>
              <p>As you explore the timeline, categories, living margins, and haiku dossier, click the heart badge on any artwork or haiku to save it to your private collection.</p>
              <div style="display:flex; gap:12px; justify-content:center; margin-top:16px;">
                <a href="#/timeline" class="primary-archive-btn" style="display: inline-block;">EXPLORE TIMELINE ⟶</a>
                <a href="#/dossier" class="primary-archive-btn" style="display: inline-block;">HAIKU DOSSIER ⟶</a>
              </div>
            </div>
          `;
        } else {
          const showHaikus = (activeStackTab === 'all' || activeStackTab === 'haikus') && stackHaikus.length > 0;
          const showWorks = (activeStackTab === 'all' || activeStackTab === 'works') && stackWorks.length > 0;

          if (showHaikus) {
            html += `
              <div style="margin-bottom: 36px;">
                <h3 style="font-family: var(--font-sans-ui); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 16px; color: var(--text-muted);">Saved Haikus (${stackHaikus.length})</h3>
                <div class="stack-haiku-grid">
                  ${stackHaikus.map(h => `
                    <article class="stack-haiku-card">
                      <div class="stack-haiku-header">
                        <div>
                          <span class="stack-haiku-author">${h.author}</span>
                          ${h.year ? `<span class="stack-haiku-meta"> · ${h.year}</span>` : ''}
                        </div>
                        <button class="card-stack-btn active" data-haiku-id="${h._storedKey || h.stackKey || ('haiku:' + h.id)}" title="Remove Haiku from Stack" type="button" onclick="window.toggleHaikuStack('${h._storedKey || h.stackKey || ('haiku:' + h.id)}', this); renderStackView();">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                        </button>
                      </div>
                      <div class="stack-haiku-content">
                        <div class="stack-haiku-jp-box">${h.jp}</div>
                        <div class="stack-haiku-texts">
                          <div class="stack-haiku-en">“${h.en || h.literal || ''}”</div>
                          ${h.romaji ? `<div class="stack-haiku-romaji">${h.romaji}</div>` : ''}
                        </div>
                      </div>
                    </article>
                  `).join('')}
                </div>
              </div>
            `;
          }

          if (showWorks) {
            html += `
              <div>
                ${activeStackTab === 'all' && stackHaikus.length > 0 ? `
                  <h3 style="font-family: var(--font-sans-ui); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 16px; color: var(--text-muted);">Saved Artworks (${stackWorks.length})</h3>
                ` : ''}
                <div class="artwork-grid" id="stack-artwork-grid">
                  ${renderArtworkGridCards(stackWorks)}
                </div>
              </div>
            `;
          }
        }

        html += `</div>`;
        appRoot.innerHTML = html;

        document.querySelectorAll('.stack-tab-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            activeStackTab = btn.getAttribute('data-tab');
            renderStackView();
          });
        });

        const clearBtn = document.getElementById('clear-stack-btn');
        if (clearBtn) {
          clearBtn.addEventListener('click', () => {
            if (confirm('Clear all saved artworks and haikus from your curatorial stack?')) {
              CuratorialStack.clear();
              showStackToast('Curatorial stack cleared');
              renderStackView();
            }
          });
        }
      }

      // 4. VIEW: TIMELINE (#/timeline)
      function renderTimelineView() {
        const featuredWorks = artworks.filter(w => w.featured);
        const eras = categories.filter(c => c.level === 'era');

        let html = `
          <div class="timeline-page">
            <header class="timeline-intro">
              <h1>Cats in arts</h1>
              <p>A collection of cats in art from cultures all over the world, from the earliest known depictions to today.</p>
            </header>

            <div class="timeline-container timeline-scroller">
              <div class="timeline-central-spine"></div>
        `;

        let itemIndex = 0;
        let sideIndex = 0;

        eras.forEach(era => {
          const eraWorks = featuredWorks.filter(w => {
            if (w.era_id !== era.id) return false;
            const ar = w.aspect_ratio || 1.0;
            return ar >= 0.45 && ar <= 3.8;
          });
          const allEraWorks = artworks.filter(w => w.era_id === era.id);

          html += `
            <div class="era-heading-node" id="era-node-${era.id}" data-era-id="${era.id}" data-era-name="${era.name}">
              <span class="era-node-pill">ERA INVENTORY [${allEraWorks.length} WORKS]</span>
              <h2 class="era-heading-title">${era.name}</h2>
              <div class="era-heading-range">${era.start_year < 0 ? Math.abs(era.start_year) + ' BCE' : era.start_year + ' CE'} — ${era.end_year < 0 ? Math.abs(era.end_year) + ' BCE' : era.end_year + ' CE'}</div>
            </div>
          `;

          if (era.id === 'era-19th-century') {
            const victorianWorks = eraWorks.filter(w => w.movement_id === 'mov-victorian-cat-art');
            const impressionistWorks = eraWorks.filter(w => w.movement_id === 'mov-impressionism' || w.movement_id === 'mov-post-impressionism');
            const symbolismWorks = eraWorks.filter(w => w.movement_id === 'mov-symbolism-art-nouveau');
            const realismWorks = eraWorks.filter(w => w.movement_id === 'mov-romanticism-realism' || w.movement_id === 'mov-folk-naive');

            html += `
              <div class="strand-split-section" data-era-id="${era.id}" data-era-name="19th Century" data-mov-name="Parallel Strands" data-color="#000000">
                <div class="strand-split-intro">
                  <span class="split-badge">SPINE CONCURRENCY [1860 — 1910]</span>
                  <h3>The Polyphonic Century: Parallel Strands</h3>
                  <p>In the late nineteenth century, artistic schools diverged concurrently. The spine branches into four parallel strands before reuniting at the fin-de-siècle.</p>
                </div>

                <div class="parallel-strands-grid">
                  <div class="strand-lane">
                    <div class="strand-lane-header">
                      <div class="strand-lane-name">Victorian Salon</div>
                      <div class="strand-lane-date">1860 — 1910</div>
                    </div>
                    <div class="strand-lane-cards">
                      ${victorianWorks.map(w => renderStrandCard(w)).join('')}
                    </div>
                  </div>

                  <div class="strand-lane">
                    <div class="strand-lane-header">
                      <div class="strand-lane-name">Impressionism</div>
                      <div class="strand-lane-date">1870 — 1905</div>
                    </div>
                    <div class="strand-lane-cards">
                      ${impressionistWorks.map(w => renderStrandCard(w)).join('')}
                    </div>
                  </div>

                  <div class="strand-lane">
                    <div class="strand-lane-header">
                      <div class="strand-lane-name">Symbolism &amp; Art Nouveau</div>
                      <div class="strand-lane-date">1885 — 1914</div>
                    </div>
                    <div class="strand-lane-cards">
                      ${symbolismWorks.map(w => renderStrandCard(w)).join('')}
                    </div>
                  </div>

                  <div class="strand-lane">
                    <div class="strand-lane-header">
                      <div class="strand-lane-name">Realism &amp; Folk Art</div>
                      <div class="strand-lane-date">1840 — 1890</div>
                    </div>
                    <div class="strand-lane-cards">
                      ${realismWorks.map(w => renderStrandCard(w)).join('')}
                    </div>
                  </div>
                </div>

                <div class="strands-converge-node">
                  <span>↓ PARALLEL STRANDS MERGE AT THE FIN-DE-SIÈCLE ↓</span>
                </div>
              </div>
            `;
          } else {
            eraWorks.forEach(work => {
              itemIndex++;
              const mov = categoryMap.get(work.movement_id) || era;
              const isSpotlight = (itemIndex % 5 === 0);

              if (isSpotlight) {
                const aspect = getArtworkAspect(work);
                html += `
                  <div class="timeline-spotlight-item" data-era-id="${era.id}" data-era-name="${era.name}" data-mov-name="${mov.name}">
                    <article class="timeline-card timeline-spotlight-card stagger-in" style="--stagger-i:${Math.min(itemIndex, 10)}" onclick="window.location.hash='#/work/${work.id}'">
                      <div class="timeline-card-header">
                        <span class="inv-stamp">${work.inv_number} · WATERSHED SPOTLIGHT</span>
                        <div class="timeline-card-header-right">
                          <span class="fabric-tag">${work.date_display}</span>
                          <button class="card-stack-btn ${CuratorialStack.has(work.id) ? 'active' : ''}" data-work-id="${work.id}" title="Add to Curatorial Stack" onclick="event.stopPropagation(); window.toggleWorkStack('${work.id}', this);">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="${CuratorialStack.has(work.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                          </button>
                        </div>
                      </div>
                      <div class="card-thumb-wrap${lqClass(work)}" style="aspect-ratio: ${aspect};${lqStyle(work)}" data-photo-max-w="${work.max_width || ''}" data-photo-max-h="${work.max_height || ''}">
                        ${renderCardMedia(work, 900, '(min-width: 900px) 860px, 82vw', itemIndex <= 2)}
                      </div>
                      <h3 class="card-title-eng" style="font-size: clamp(20px, 2.5vw, 28px);">${work.title_eng || work.title}</h3>
                      ${work.title_eng && work.title_eng !== work.title ? `<div class="card-title-orig">${work.title}</div>` : ''}
                      <div class="card-artist-meta settle-detail" style="--stagger-i:${Math.min(itemIndex, 10)}">${work.artist} (${work.artist_dates || work.culture})</div>
                      ${work.description ? `<p class="card-desc-snippet" style="font-size: 14px; max-width: 760px;">${work.description}</p>` : (work.attribution ? `<p class="card-desc-snippet card-attribution">${work.attribution}</p>` : '')}
                      <div class="card-tags-row settle-detail" style="--stagger-i:${Math.min(itemIndex, 10)}">
                        <span class="fabric-tag">${mov.name}</span>
                        <span class="fabric-tag">${work.culture}</span>
                      </div>
                    </article>
                  </div>
                `;
              } else {
                const isLeft = sideIndex % 2 === 0;
                const isStacked = sideIndex % 2 === 1;
                sideIndex++;
                const aspect = getArtworkAspect(work);

                html += `
                  <div class="timeline-item ${isLeft ? 'left' : 'right'} ${isStacked ? 'stacked-card' : 'spaced-card'}" data-era-id="${era.id}" data-era-name="${era.name}" data-mov-name="${mov.name}">
                    <article class="timeline-card stagger-in" style="--stagger-i:${Math.min(itemIndex, 10)}" onclick="window.location.hash='#/work/${work.id}'">
                      <div class="timeline-card-header">
                        <span class="inv-stamp">${work.inv_number}</span>
                        <div class="timeline-card-header-right">
                          <span class="fabric-tag">${work.date_display}</span>
                          <button class="card-stack-btn ${CuratorialStack.has(work.id) ? 'active' : ''}" data-work-id="${work.id}" title="Add to Curatorial Stack" onclick="event.stopPropagation(); window.toggleWorkStack('${work.id}', this);">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="${CuratorialStack.has(work.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                          </button>
                        </div>
                      </div>
                      <div class="card-thumb-wrap${lqClass(work)}" style="aspect-ratio: ${aspect};${lqStyle(work)}" data-photo-max-w="${work.max_width || ''}" data-photo-max-h="${work.max_height || ''}">
                        ${renderCardMedia(work, 500, '(min-width: 900px) 460px, 82vw', itemIndex <= 4)}
                      </div>
                      <h3 class="card-title-eng">${work.title_eng || work.title}</h3>
                      ${work.title_eng && work.title_eng !== work.title ? `<div class="card-title-orig">${work.title}</div>` : ''}
                      <div class="card-artist-meta settle-detail" style="--stagger-i:${Math.min(itemIndex, 10)}">${work.artist} (${work.artist_dates || work.culture})</div>
                      ${work.description ? `<p class="card-desc-snippet">${work.description.length > 170 ? work.description.slice(0, 170) + '…' : work.description}</p>` : (work.attribution ? `<p class="card-desc-snippet card-attribution">${work.attribution}</p>` : '')}
                      <div class="card-tags-row settle-detail" style="--stagger-i:${Math.min(itemIndex, 10)}">
                        <span class="fabric-tag">${mov.name}</span>
                      </div>
                    </article>
                  </div>
                `;
              }
            });
          }

          html += `
            <div class="view-all-node">
              <a href="#/category/${era.id}" class="view-all-link">
                VIEW ALL ${allEraWorks.length} WORKS — ${era.name.toUpperCase()} ⟶
              </a>
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;

        appRoot.innerHTML = html;
        setupTimelineObserver();
        setupMiddleplaneTimelineScroll();
      }

      function renderStrandCard(work) {
        const aspect = getArtworkAspect(work);
        return `
          <article class="timeline-card" onclick="window.location.hash='#/work/${work.id}'">
            <div class="timeline-card-header">
              <span class="inv-stamp">${work.inv_number}</span>
              <span class="fabric-tag">${work.date_display}</span>
            </div>
            <div class="card-thumb-wrap${lqClass(work)}" style="aspect-ratio: ${aspect};${lqStyle(work)}" data-photo-max-w="${work.max_width || ''}" data-photo-max-h="${work.max_height || ''}">
              ${renderCardMedia(work, 400, '(min-width: 1100px) 300px, (min-width: 600px) 45vw, 82vw', false)}
            </div>
            <h4 class="card-title-eng">${work.title_eng || work.title}</h4>
            <div class="card-artist-meta">${work.artist}</div>
          </article>
        `;
      }

      function setupTimelineObserver() {
        const items = document.querySelectorAll('.timeline-item');
        const nodes = document.querySelectorAll('.era-heading-node, .timeline-item, .timeline-spotlight-item, .strand-split-section');

        const revealObserver = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.classList.add('revealed');
              revealObserver.unobserve(entry.target); // one-shot: stop paying for it on every scroll
            }
          });
        }, { threshold: 0, rootMargin: '0px 0px -4% 0px' }); // starts as soon as a card peeks in

        items.forEach(el => revealObserver.observe(el));

        const sideObserver = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              if (isProgrammaticEraScroll) return;
              const era = entry.target.dataset.eraName;
              const mov = entry.target.dataset.movName || '';
              const eraId = entry.target.dataset.eraId;

              if (eraId) setActiveEra(eraId);
              if (sideEraLabel) sideEraLabel.textContent = era || '';
              if (sideMovLabel) sideMovLabel.textContent = mov || '';
              if (mobileEraTitle) mobileEraTitle.textContent = era || '';
              if (mobileMovTitle) mobileMovTitle.textContent = mov || '';
            }
          });
        }, { threshold: 0.3 });

        nodes.forEach(el => sideObserver.observe(el));
        window.activeTimelineObservers = [revealObserver, sideObserver];
        EraProgress.attach();
      }

      // Era progress rail: a hairline under the era name (side indicator / mobile era bar)
      // fills as you read through the current era. Heading positions are cached and only
      // re-read when the timeline's size changes, so a scroll frame is arithmetic plus one
      // transform write.
      const EraProgress = (() => {
        const fills = () => document.querySelectorAll('.era-progress-fill');
        let tops = [], end = 0, ro = null, page = null, ticking = false, lastP = -1;
        const ANCHOR = 0.35; // reading line: 35% down the viewport

        function measure() {
          if (!page || !page.isConnected) return;
          const y = window.scrollY;
          tops = Array.from(page.querySelectorAll('.era-heading-node'))
            .map(n => n.getBoundingClientRect().top + y);
          const r = page.getBoundingClientRect();
          end = r.bottom + y;
          update();
        }
        function update() {
          ticking = false;
          if (!tops.length) return;
          const line = window.scrollY + window.innerHeight * ANCHOR;
          let i = tops.length - 1;
          while (i > 0 && tops[i] > line) i--;
          const from = tops[i];
          const to = i + 1 < tops.length ? tops[i + 1] : end;
          const p = Math.max(0, Math.min(1, (line - from) / Math.max(1, to - from)));
          if (Math.abs(p - lastP) < 0.002) return;
          lastP = p;
          const t = `scaleX(${p.toFixed(4)})`;
          fills().forEach(f => { f.style.transform = t; });
        }
        const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', () => requestAnimationFrame(measure), { passive: true });

        return {
          attach() {
            page = document.querySelector('.timeline-page');
            lastP = -1;
            if (ro) ro.disconnect();
            if (!page || !window.ResizeObserver) { tops = []; requestAnimationFrame(measure); return; }
            let pending = false;
            ro = new ResizeObserver(() => {
              if (pending) return;
              pending = true;
              requestAnimationFrame(() => { pending = false; measure(); });
            });
            ro.observe(page);
          }
        };
      })();

      // Persona 5 Shibuya Cut-Out Tokens & Typography Helpers
      const categoryTypologyState = {};
      let tilesResizeObserver = null;

      const FELINE_VOCALISATIONS = [
        'MEOW!', 'PURRRRRR!', 'MEOOOW!', 'HISS!', 'PRRRR!', 'HISSSSSS!',
        'MRRR?', 'NYA!', 'MIAOU!', 'PURR-PURR', 'SSSHHH!', 'CHIRP!',
        'YOWL!', 'MROW!', 'EK-EK-EK', 'MRRRAOW!', 'PURRRR...', 'HSSS!',
        'MEW!', 'CHITTER', 'PRR-PRR!', 'NYAAAN!', 'MIAU!', 'KHRRR!',
        'MOW!', 'PURRBOX', 'YOWWWL!', 'HISSSS!', 'MEOWW!', 'MRRRT!'
      ];

      const P5_CLIP_POLYGONS = [
        'polygon(3% 0%, 98% 4%, 95% 98%, 0% 93%)',
        'polygon(0% 5%, 96% 0%, 100% 95%, 4% 100%)',
        'polygon(5% 2%, 100% 0%, 94% 100%, 0% 96%)',
        'polygon(2% 0%, 97% 6%, 100% 96%, 0% 100%)',
        'polygon(0% 3%, 100% 0%, 96% 97%, 3% 100%)'
      ];

      const TYPOLOGY_ORDER = [
        'Painting',
        'Sculpture',
        'Bronze',
        'Jewellery',
        'Drawing & Watercolor',
        'Print',
        'Ceramic',
        'Manuscript',
        'Mosaic',
        'Textile',
        'Decorative Art',
        'Archaeology',
        'Photography',
        'Literature & Folklore'
      ];

      function getRandomFelineVocalisation() {
        return FELINE_VOCALISATIONS[Math.floor(Math.random() * FELINE_VOCALISATIONS.length)];
      }

      // Fleeting Ghost Paw on Click (0.1% chance, flies away and dissolves in <1s)
      function spawnGhostPaw(x, y) {
        const paw = document.createElement('div');
        paw.className = 'fleeting-ghost-paw';
        paw.style.left = `${x}px`;
        paw.style.top = `${y}px`;
        paw.setAttribute('aria-hidden', 'true');
        paw.innerHTML = `
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 13c-2.2 0-4 1.8-4 4 0 1.5 1 2.8 2.4 3.3l.6.2.6-.2c.4-.1.9-.3 1.4-.3s1 .2 1.4.3l.6.2.6-.2C17 19.8 18 18.5 18 17c0-2.2-1.8-4-4-4zm-4.5-3c1.4 0 2.5-1.3 2.5-3S8.9 4 7.5 4 5 5.3 5 7s1.1 3 2.5 3zm9 0c1.4 0 2.5-1.3 2.5-3S17.9 4 16.5 4 14 5.3 14 7s1.1 3 2.5 3zM4 14c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm16 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/>
          </svg>
        `;
        document.body.appendChild(paw);
        setTimeout(() => paw.remove(), 850);
      }

      // Smooth active glider for the typology contact strip
      function positionTypoGlider(stripEl, animate = false) {
        if (!stripEl) return;
        const activeBtn = stripEl.querySelector('.typo-btn.active');
        let glider = stripEl.querySelector('.typo-glider');
        if (!glider) {
          glider = document.createElement('span');
          glider.className = 'typo-glider';
          glider.setAttribute('aria-hidden', 'true');
          stripEl.insertBefore(glider, stripEl.firstChild);
        }
        stripEl.classList.add('has-glider');
        if (!activeBtn) {
          glider.style.display = 'none';
          return;
        }
        glider.style.display = 'block';
        if (!animate) {
          glider.style.transition = 'none';
        } else {
          glider.style.transition = 'transform 0.15s cubic-bezier(0.2, 0, 0, 1), width 0.15s cubic-bezier(0.2, 0, 0, 1)';
        }
        const x = activeBtn.offsetLeft;
        const w = activeBtn.offsetWidth;
        glider.style.transform = `translateX(${x}px)`;
        glider.style.width = `${w}px`;
        if (!animate) {
          void glider.offsetWidth;
          glider.style.transition = 'transform 0.15s cubic-bezier(0.2, 0, 0, 1), width 0.15s cubic-bezier(0.2, 0, 0, 1)';
        }
      }

      window.addEventListener('resize', () => {
        document.querySelectorAll('.typology-strip').forEach(s => positionTypoGlider(s, false));
      });

      // Setup Minimalist Chevrons for Glidable Mobile Typology Strip
      function setupTypologyScrollIndicators(stripEl) {
        if (!stripEl) return;
        const wrap = stripEl.closest('.typology-strip-scroll-wrap');
        if (!wrap) return;
        const leftArrow = wrap.querySelector('.typo-scroll-left');
        const rightArrow = wrap.querySelector('.typo-scroll-right');

        function update() {
          const maxScroll = stripEl.scrollWidth - stripEl.clientWidth;
          const isScrollable = maxScroll > 6;
          if (!isScrollable) {
            if (leftArrow) leftArrow.classList.remove('visible');
            if (rightArrow) rightArrow.classList.remove('visible');
            return;
          }
          const scrollLeft = stripEl.scrollLeft;
          if (leftArrow) leftArrow.classList.toggle('visible', scrollLeft > 6);
          if (rightArrow) rightArrow.classList.toggle('visible', scrollLeft < maxScroll - 6);
        }

        stripEl.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update, { passive: true });
        setTimeout(update, 50);

        if (leftArrow && !leftArrow.dataset.wired) {
          leftArrow.dataset.wired = '1';
          leftArrow.addEventListener('click', (e) => {
            e.stopPropagation();
            stripEl.scrollBy({ left: -140, behavior: Motion.scroll() });
          });
        }
        if (rightArrow && !rightArrow.dataset.wired) {
          rightArrow.dataset.wired = '1';
          rightArrow.addEventListener('click', (e) => {
            e.stopPropagation();
            stripEl.scrollBy({ left: 140, behavior: Motion.scroll() });
          });
        }
      }

      function measurePillTextWidth(text) {
        let ruler = document.getElementById('pill-measurement-ruler');
        if (!ruler) {
          ruler = document.createElement('span');
          ruler.id = 'pill-measurement-ruler';
          ruler.style.cssText = [
            'position: fixed',
            'top: -9999px',
            'left: -9999px',
            'visibility: hidden',
            'white-space: nowrap',
            'font-family: var(--font-mono, monospace)',
            'font-size: 8.5px',
            'letter-spacing: 0.08em',
            'text-transform: uppercase',
            'padding: 0',
            'margin: 0',
            'border: 0'
          ].join(';');
          document.body.appendChild(ruler);
        }
        ruler.textContent = text;
        return ruler.getBoundingClientRect().width;
      }

      function setTileActivePill(tile, rawType) {
        const pill = tile.querySelector('.cat-tile-active-pill');
        if (!pill) return;

        const targetType = (rawType || '').trim().toUpperCase();

        // If no type or 'ALL', fade out then collapse
        if (!targetType || targetType === 'ALL') {
          pill.classList.remove('visible');
          pill.removeAttribute('data-current-type');
          const collapse = () => {
            // Only if nothing re-opened the pill while it was fading
            if (pill.hasAttribute('data-current-type')) return;
            pill.style.width = '0px';
            pill.style.display = 'none';
            const roller = pill.querySelector('.pill-roller');
            if (roller) roller.innerHTML = '';
            cancelAnims(pill);
          };
          if (Motion.reduced || pill.style.display === 'none' || !pill.offsetWidth) { collapse(); return; }
          cancelAnims(pill);
          pill.animate([{ opacity: 1 }, { opacity: 0 }], { duration: Motion.dur('fast'), easing: Motion.ease.in, fill: 'forwards' })
            .finished.then(collapse).catch(() => {});
          return;
        }

        // Idempotent: already displaying this type
        if (pill.getAttribute('data-current-type') === targetType && pill.classList.contains('visible')) {
          return;
        }

        // Measure text with safety buffer (padding: 12px + borders: 2px + subpixel: 2px)
        const textWidth = measurePillTextWidth(targetType);
        if (textWidth <= 0) {
          pill.classList.remove('visible');
          pill.style.display = 'none';
          return;
        }
        const targetWidth = Math.ceil(textWidth + 16);

        // Setup container
        pill.setAttribute('data-current-type', targetType);
        cancelAnims(pill);
        pill.style.display = 'inline-flex';

        let roller = pill.querySelector('.pill-roller');
        if (!roller) {
          roller = document.createElement('span');
          roller.className = 'pill-roller';
          pill.appendChild(roller);
        }

        const oldText = roller.querySelector('.pill-text:not(.pill-exiting)');

        // Stage incoming text element
        const newText = document.createElement('span');
        newText.className = 'pill-text pill-entering';
        newText.textContent = targetType;
        roller.appendChild(newText);

        // Force layout flush so translateY(130%) registers before transitioning
        void newText.offsetWidth;

        // Execute simultaneous width expansion and vertical film-roll
        pill.style.width = `${targetWidth}px`;
        pill.classList.add('visible');

        if (oldText) {
          oldText.classList.remove('pill-active');
          oldText.classList.add('pill-exiting');
          setTimeout(() => {
            if (oldText.parentNode === roller) {
              roller.removeChild(oldText);
            }
          }, 300);
        }

        newText.classList.remove('pill-entering');
        newText.classList.add('pill-active');
      }

      function spawnPersona5ShibuyaVocalisation(btnEl, forcedWord) {
        if (!btnEl) return;
        const word = (forcedWord || getRandomFelineVocalisation()).toUpperCase();

        btnEl.classList.remove('p5-recoil-active');
        void btnEl.offsetWidth;
        btnEl.classList.add('p5-recoil-active');

        btnEl.querySelectorAll('.p5-ransom-above-container').forEach(p => p.remove());

        const container = document.createElement('div');
        container.className = 'p5-ransom-above-container';

        Array.from(word).forEach((ch, idx) => {
          if (ch === ' ') return;
          const span = document.createElement('span');
          const isLead = idx === 0;
          const dir = idx % 2 === 0 ? -1 : 1;
          const rot = (dir * (3 + Math.floor(Math.random() * 6))).toFixed(1) + 'deg';
          const dy = (dir * (1 + Math.floor(Math.random() * 2))) + 'px';
          const scale = isLead ? 1.15 : (0.94 + Math.random() * 0.14).toFixed(2);
          const clip = P5_CLIP_POLYGONS[idx % P5_CLIP_POLYGONS.length];

          // Classic Shibuya Variant B Swatches: Crimson (#d91828), White, and Noir
          let swatchClass = 'p5-swatch-black';
          if (isLead || idx % 4 === 3) {
            swatchClass = 'p5-swatch-crimson';
          } else if (idx % 2 === 1) {
            swatchClass = 'p5-swatch-white';
          } else {
            swatchClass = 'p5-swatch-black';
          }

          span.className = `p5-char-box ${swatchClass} ${isLead ? 'is-lead-char' : ''}`;
          span.style.setProperty('--char-rot', rot);
          span.style.setProperty('--char-y', dy);
          span.style.setProperty('--char-scale', scale);
          span.style.setProperty('--char-clip', clip);
          span.textContent = ch;
          container.appendChild(span);
        });

        const tail = document.createElement('span');
        tail.className = 'p5-ransom-tail';
        container.appendChild(tail);

        btnEl.appendChild(container);
        try { playNyaaSound(); } catch (e) {}
        setTimeout(() => container.remove(), 850);
      }

      function formatEraOrMovementDates(cat) {
        if (!cat) return '';
        const s = cat.start_year < 0 ? Math.abs(cat.start_year) + ' BCE' : cat.start_year + ' CE';
        const e = cat.end_year < 0 ? Math.abs(cat.end_year) + ' BCE' : cat.end_year + ' CE';
        return `${s} — ${e}`;
      }

      // 5. VIEW: CATEGORIES CATALOGUE (#/categories)
      // ============================================================================
      // ARCHIVE SEARCH — one index over every field, shared by the Categories page
      // and the per-category grids.
      //   • every term must match somewhere (AND); fields are weighted (artist > title > …)
      //   • accents/case folded ("catalhoyuk" finds Çatalhöyük, "lodz" finds Łódź)
      //   • word-start prefix matching, simple plurals ("prints" → print)
      //   • "quoted phrases", field qualifiers (artist:wain, type:print, era:egypt, …)
      //   • dates: 1475 · 1800s · 19th century · 1500-1600 · 3000 bce
      //   • a term that matches nothing is retried against the closest known word (typos)
      // ============================================================================
      const ArchiveSearch = (() => {
        const fold = s => String(s ?? '')
          .replace(/[łŁ]/g, 'l').replace(/[œŒ]/g, 'oe').replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'o').replace(/ß/g, 'ss').replace(/[đĐ]/g, 'd')
          .normalize('NFKD').replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .replace(/['’ʼ`]/g, '')
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim();

        const NOISE_TAGS = /^(cats?|felines?|cat-in-art|complete-cultural-history|example-\d+|tt\d+)$/;
        const isAnonymous = name => !name || /^(unknown|anonymous)\b/i.test(name.trim());

        // field key → [weight, extractor]
        const FIELDS = {
          artist:   [10, w => [w.artist]],
          title:    [8,  w => [w.title, w.title_eng, w.title_original]],
          movement: [6,  w => [categoryMap.get(w.movement_id)?.name, w.submovement]],
          type:     [6,  w => [w.type]],
          era:      [5,  w => [categoryMap.get(w.era_id)?.name]],
          culture:  [5,  w => [w.culture, w.artist_dates]],
          tag:      [5,  w => (w.tags || []).filter(t => !NOISE_TAGS.test(t))],
          medium:   [3,  w => [w.medium]],
          museum:   [3,  w => [w.collection, w.location, w.accession_number, w.inv_number]],
          date:     [4,  w => [w.date_display]],
          text:     [1,  w => [w.description, w.context, w.feline_symbolism]],
        };
        const ALIASES = {
          artist: 'artist', by: 'artist', author: 'artist', maker: 'artist',
          title: 'title', name: 'title',
          movement: 'movement', mov: 'movement', school: 'movement', style: 'movement',
          type: 'type', kind: 'type', typology: 'type',
          era: 'era', period: 'era',
          culture: 'culture', origin: 'culture', country: 'culture',
          tag: 'tag', tags: 'tag',
          medium: 'medium', material: 'medium',
          museum: 'museum', collection: 'museum',
          year: 'year', date: 'year',
        };
        const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'and', 'or', 'with', 'by', 'from', 'to', 'at', 'for', 'century', 'centuries', 'c', 'ca', 'circa']);
        const CAT_WORDS = new Set(['cat', 'cats', 'feline', 'felines', 'kitty']);

        let index = null;   // [{ w, year, f: { field: ' folded text ' } }]
        let vocab = null;   // Set of words from the short fields (for typo fallback)
        function build() {
          if (index) return;
          vocab = new Set();
          index = artworks.map(w => {
            const f = {};
            for (const [key, [, get]] of Object.entries(FIELDS)) {
              const txt = fold(get(w).filter(Boolean).join(' · '));
              f[key] = ' ' + txt + ' ';
              if (key !== 'text') txt.split(' ').forEach(t => { if (t.length >= 4) vocab.add(t); });
            }
            const y = typeof w.year === 'number' ? w.year : (typeof w.year_sort === 'number' ? w.year_sort : parseInt(w.year, 10));
            return { w, year: Number.isFinite(y) ? y : null, f };
          });
        }

        const singular = t => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss')) ? t.slice(0, -1) : t;

        // Date-ish term → [from, to] or null
        function yearRange(raw, bce) {
          const sign = bce ? -1 : 1;
          let m;
          if ((m = raw.match(/^(\d{1,4})\s*[-–—]\s*(\d{1,4})$/))) {
            const a = sign * +m[1], b = sign * +m[2];
            return [Math.min(a, b), Math.max(a, b)];
          }
          if ((m = raw.match(/^(\d{1,2})(st|nd|rd|th)$/))) {          // 19th (century)
            const n = +m[1];
            return bce ? [-n * 100, -(n - 1) * 100 - 1] : [(n - 1) * 100 + 1, n * 100];
          }
          if ((m = raw.match(/^(\d{2,4})s$/))) {                       // 1800s / 1920s
            const n = +m[1];
            const span = n % 100 === 0 ? 99 : n % 10 === 0 ? 9 : 0;
            return bce ? [-(n + span), -n] : [n, n + span];
          }
          if (bce && (m = raw.match(/^(\d{1,5})$/))) return [-+m[1], -+m[1]];
          return null;
        }

        /** Parse a query string into terms: { field|null, text (folded), range|null, raw } */
        function parse(query) {
          const terms = [];
          const src = String(query || '');
          const bce = /\b(bce|bc|b\.c\.e?\.?)\b/i.test(src);
          const re = /(?:(\w+):)?(?:"([^"]*)"?|(\S+))/g;
          let m;
          while ((m = re.exec(src))) {
            const qual = m[1] && ALIASES[m[1].toLowerCase()];
            let raw = (m[2] ?? m[3] ?? '').trim();
            if (m[1] && !qual) raw = m[0].replace(/"/g, ''); // unknown "foo:bar" → plain text
            if (!raw) continue;
            if (/^(bce|bc|b\.c\.e?\.?|ce|ad|a\.d\.)$/i.test(raw)) continue;
            const range = yearRange(raw.toLowerCase(), bce);
            if (range) { terms.push({ field: 'year', range, raw }); continue; }
            if (qual === 'year' && /^\d+$/.test(raw)) { terms.push({ field: 'year', range: [+raw, +raw], raw }); continue; }
            const text = fold(raw);
            if (!text) continue;
            terms.push({ field: qual && qual !== 'year' ? qual : null, text, raw, phrase: m[2] !== undefined });
          }
          // Drop filler words and "cat(s)" unless the query is nothing but those
          const meaningful = terms.filter(t => t.range || t.field || t.phrase || !(STOPWORDS.has(t.text) || CAT_WORDS.has(t.text)));
          return meaningful.length ? meaningful : terms.filter(t => !STOPWORDS.has(t.text) || terms.length === 1);
        }

        // CJK has no spaces between words, so any substring is a fair match there
        const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
        // British/American spellings and other variants that prefix matching can't bridge
        const VARIANTS = {
          jewelry: 'jewellery', jewellery: 'jewelry', gray: 'grey', grey: 'gray',
          color: 'colour', colour: 'color', colored: 'coloured', coloured: 'colored',
          woodcut: 'woodblock', woodblock: 'woodcut', kitty: 'kitten',
        };

        function scoreOne(hay, text, weight) {
          if (hay.includes(' ' + text + ' ')) return weight;              // whole word / phrase
          if (hay.includes(' ' + text)) return weight * 0.6;              // word prefix
          const s = singular(text);
          if (s !== text && hay.includes(' ' + s)) return weight * 0.55;  // plural → singular prefix
          if ((text.length >= 4 || CJK.test(text)) && hay.includes(text)) return weight * (CJK.test(text) ? 0.9 : 0.25); // inside a word
          return 0;
        }
        function scoreText(hay, text, weight) {
          const alt = VARIANTS[text];
          return alt ? Math.max(scoreOne(hay, text, weight), scoreOne(hay, alt, weight)) : scoreOne(hay, text, weight);
        }

        function scoreTerm(entry, term) {
          if (term.range) {
            const [a, b] = term.range;
            if (entry.year !== null && entry.year >= a && entry.year <= b) return 4;
            // Ancient dates are approximate: a single BCE year also finds works within ~10% of it
            if (a === b && a < 0 && entry.year !== null) {
              const tol = Math.min(500, Math.max(50, Math.abs(a) * 0.1));
              if (Math.abs(entry.year - a) <= tol) return 2;
            }
            // fall back to the printed date ("c. 1475", "19th century")
            return a === b ? scoreText(entry.f.date, String(Math.abs(a)), 3) : 0;
          }
          if (term.field) {
            const hay = entry.f[term.field];
            return hay ? scoreText(hay, term.text, FIELDS[term.field][0]) : 0;
          }
          let best = 0;
          for (const key in FIELDS) {
            const s = scoreText(entry.f[key], term.text, FIELDS[key][0]);
            if (s > best) best = s;
          }
          return best;
        }

        // Closest vocabulary word within edit distance 1 (≤7 chars) or 2 (longer)
        function nearestWord(word) {
          if (word.length < 4 || word.includes(' ')) return null;
          const max = word.length >= 8 ? 2 : 1;
          let best = null, bestD = max + 1;
          for (const v of vocab) {
            if (Math.abs(v.length - word.length) > max) continue;
            const d = editDistance(word, v, bestD);
            if (d < bestD) { bestD = d; best = v; if (d === 1 && max === 1) break; }
          }
          return best;
        }
        // Optimal string alignment distance (a swap of two neighbours costs 1); stops early at `cap`
        function editDistance(a, b, cap) {
          let prev2 = null;
          let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
          for (let i = 1; i <= a.length; i++) {
            const cur = [i];
            let rowMin = i;
            for (let j = 1; j <= b.length; j++) {
              cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
              if (prev2 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
              if (cur[j] < rowMin) rowMin = cur[j];
            }
            if (rowMin >= cap) return cap;
            prev2 = prev;
            prev = cur;
          }
          return prev[b.length];
        }

        function run(terms, pool) {
          const out = [];
          for (const entry of pool) {
            let total = 0;
            for (const t of terms) {
              const s = scoreTerm(entry, t);
              if (!s) { total = 0; break; }
              total += s;
            }
            if (total) out.push({ w: entry.w, score: total, year: entry.year });
          }
          return out;
        }

        /**
         * search(query, works?) → { results: [{w, score}], terms, corrected: [[from, to]] }
         * `works` limits the pool (e.g. one category); results are sorted by relevance, then date.
         */
        function search(query, works = null) {
          build();
          let terms = parse(query);
          if (!terms.length) return { results: [], terms, corrected: [] };
          const pool = works ? index.filter(e => works.includes(e.w)) : index;
          let results = run(terms, pool);
          const corrected = [];
          if (!results.length) {
            // Retry with typo-corrected free-text terms that match nothing on their own
            const fixed = terms.map(t => {
              if (t.range || t.phrase || pool.some(e => scoreTerm(e, t))) return t;
              const near = nearestWord(t.text);
              if (!near) return t;
              corrected.push([t.raw, near]);
              return { ...t, text: near };
            });
            if (corrected.length) { terms = fixed; results = run(terms, pool); }
          }
          results.sort((a, b) => b.score - a.score || (a.year ?? 1e9) - (b.year ?? 1e9));
          return { results, terms, corrected };
        }

        /** Categories (eras & movements) whose name or introduction matches every term */
        function searchCategories(query) {
          const terms = parse(query).filter(t => !t.range && (!t.field || t.field === 'era' || t.field === 'movement'));
          if (!terms.length) return [];
          return categories
            .map(c => {
              const name = ' ' + fold(c.name) + ' ';
              const intro = ' ' + fold(c.introduction) + ' ';
              let total = 0;
              for (const t of terms) {
                const s = Math.max(scoreText(name, t.text, 6), scoreText(intro, t.text, 1));
                if (!s) return null;
                total += s;
              }
              return { c, score: total };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score || a.c.start_year - b.c.start_year)
            .map(x => x.c);
        }

        return { search, searchCategories, fold, isAnonymous, warm: build };
      })();

      function renderCategoriesView(query = {}) {
        const eras = categories.filter(c => c.level === 'era');
        const initialQ = (query && query.q) || '';

        let html = `
          <div class="categories-page${initialQ ? ' is-searching' : ''}">
            <header class="categories-header">
              <h1>Catalogue of Eras &amp; Movements</h1>
              <p>Explore feline art organized into historical periods, aesthetic schools, and object typologies.</p>
              <div class="archive-search" role="search">
                <label class="visually-hidden" for="archive-search-input">Search the whole archive</label>
                <input type="search" id="archive-search-input" class="search-input archive-search-input"
                       placeholder="SEARCH ARTISTS, TITLES, MOVEMENTS, TYPES, YEARS…"
                       autocomplete="off" spellcheck="false" enterkeyhint="search" value="${escapeAttr(initialQ)}">
                <div class="archive-search-hints" aria-label="Example searches">
                  ${['Louis Wain', 'ukiyo-e', 'bronze', 'Egypt', '1800s', 'type:print', '"black cat"'].map(ex =>
                    `<button type="button" class="archive-search-hint" data-q="${escapeAttr(ex)}">${escapeAttr(ex)}</button>`).join('')}
                </div>
              </div>
            </header>
            <section class="archive-search-results" id="archive-search-results" aria-live="polite"></section>
        `;

        eras.forEach(era => {
          const activeFilter = categoryTypologyState[era.id] || 'all';
          const eraWorks = artworks.filter(w => w.era_id === era.id);
          const movements = categories.filter(c => c.parent_id === era.id);

          // Calculate counts by type for this era
          const typeCounts = { all: eraWorks.length };
          eraWorks.forEach(w => {
            const t = w.type || 'Painting';
            typeCounts[t] = (typeCounts[t] || 0) + 1;
          });

          // Build typology buttons dynamically based on present types in this era
          const buttons = [
            { key: 'all', label: 'ALL', count: eraWorks.length }
          ];

          TYPOLOGY_ORDER.forEach(t => {
            if (typeCounts[t] && typeCounts[t] > 0) {
              buttons.push({
                key: t,
                label: t.toUpperCase(),
                count: typeCounts[t]
              });
            }
          });

          // Matching artworks under active filter
          const matchingWorks = activeFilter === 'all'
            ? eraWorks
            : eraWorks.filter(w => (w.type || 'Painting') === activeFilter);

          const activeTypoObj = buttons.find(b => b.key === activeFilter) || buttons[0];
          const eraLinkUrl = activeFilter === 'all'
            ? `#/category/${era.id}`
            : `#/category/${era.id}?type=${encodeURIComponent(activeFilter)}`;

          html += `
            <section class="era-catalogue-block" data-era-block="${era.id}">
              <div class="era-catalogue-header-group">
                <!-- 1. Era Title Row with Dedicated Category Archive Link -->
                <div class="era-catalogue-title-row">
                  <div class="era-title-left">
                    <h2 class="era-cat-name">${era.name}</h2>
                    <a href="${eraLinkUrl}" class="era-portal-link" data-era-link="${era.id}" title="Open dedicated ${escapeAttr(era.name)} archive dossier">
                      <span>VIEW ERA ARCHIVE ↗</span>
                    </a>
                  </div>
                  <div class="era-cat-dates tabular">${formatEraOrMovementDates(era)} · [${matchingWorks.length}/${eraWorks.length} WORKS]</div>
                </div>

                <!-- 2. Typology filter strip (docked ledger cells) -->
                <div class="era-typology-bar-zone">
                  <div class="typology-strip-scroll-wrap">
                    <button type="button" class="typo-scroll-arrow typo-scroll-left" aria-label="Previous categories">
                      <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 1 1 6 7 11"/></svg>
                    </button>
                    <div class="typology-strip" role="toolbar" aria-label="${escapeAttr(era.name)} Typology Filter">
                      ${buttons.map((btn, idx) => {
                        const isActive = btn.key === activeFilter;
                        const isEmpty = btn.count === 0;
                        return `
                          <button type="button" class="typo-btn tabular ${isActive ? 'active' : ''} ${isEmpty ? 'is-empty' : ''}"
                                  data-era="${era.id}" data-key="${btn.key}" aria-pressed="${isActive}">
                            <span class="typo-idx">${String(idx).padStart(2, '0')}</span>
                            <span class="typo-label">${btn.label}</span>
                            <span class="typo-count">${btn.count}</span>
                          </button>
                        `;
                      }).join('')}
                    </div>
                    <button type="button" class="typo-scroll-arrow typo-scroll-right" aria-label="Next categories">
                      <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 1 7 6 1 11"/></svg>
                    </button>
                  </div>

                  <!-- Active Filter Readout -->
                  <div class="typology-status-readout tabular">
                    ${activeFilter === 'all'
                      ? `PRESENT TYPES: <strong>${buttons.length - 1}</strong>`
                      : `ACTIVE: <strong>${activeTypoObj.label}</strong> [${String(matchingWorks.length).padStart(2, '0')}]`}
                  </div>
                </div>
              </div>

              <!-- Content Split Wrapper for Seamless Layout on Desktop & Mobile -->
              <div class="era-catalogue-split-wrapper ${activeFilter !== 'all' ? 'has-active-filter' : ''}">
                <!-- 3. Subcategories Only Grid -->
                <div class="category-tiles-grid">
                  ${movements.length > 0 ? movements.map(m => {
                    const subAllWorks = eraWorks.filter(w => w.movement_id === m.id);
                    const subFilteredWorks = activeFilter === 'all'
                      ? subAllWorks
                      : subAllWorks.filter(w => (w.type || 'Painting') === activeFilter);

                    const count = subFilteredWorks.length;
                    const isFilteredOut = count === 0;

                    const coverArt = (activeFilter !== 'all' && subFilteredWorks[0])
                      ? subFilteredWorks[0]
                      : (subAllWorks[0] || artworkSlugMap.get(m.title_artwork_id));

                    const bgImg = coverArt
                      ? (localUrl(coverArt, coverArt.image_url, 400) || getOptimizedImageUrl(coverArt.thumb_url || coverArt.image_url, 400))
                      : '';

                    const tileUrl = activeFilter === 'all'
                      ? `#/category/${m.id}`
                      : `#/category/${m.id}?type=${encodeURIComponent(activeFilter)}`;

                    const tileOrder = (activeFilter !== 'all')
                      ? (count > 0 ? `order: ${m.start_year};` : 'order: 1000000;')
                      : '';

                    return `
                      <a href="${tileUrl}" class="cat-square-tile ${isFilteredOut ? 'is-filtered-out' : ''}" data-sub-id="${m.id}" style="${tileOrder}">
                        ${bgImg ? `<div class="cat-tile-ghost-img" style="background-image: url('${bgImg}');"></div>` : ''}
                        <div class="cat-tile-top">
                          <div class="cat-tile-dates tabular">${formatEraOrMovementDates(m)}</div>
                        </div>
                        <div class="cat-tile-bottom">
                          <span class="cat-tile-active-pill ${activeFilter !== 'all' && count > 0 ? 'visible' : ''}" ${activeFilter !== 'all' && count > 0 ? `data-current-type="${escapeAttr(activeTypoObj.label)}"` : ''}>
                            ${activeFilter !== 'all' && count > 0 ? `<span class="pill-roller"><span class="pill-text">${activeTypoObj.label}</span></span>` : ''}
                          </span>
                          <h3 class="cat-tile-name">${m.name}</h3>
                          <div class="cat-tile-count tabular">
                            [ ${count} ${count === 1 ? 'WORK' : 'WORKS'} ${activeFilter === 'all' ? 'CATALOGUED' : 'MATCHING'} ]
                          </div>
                        </div>
                      </a>
                    `;
                  }).join('') : renderCategorySquareTile(era, eraWorks.length)}
                </div>

                <!-- 4. Matching Artworks Specimen Drawer -->
                <div class="filtered-specimens-strip ${activeFilter !== 'all' ? 'visible' : ''}">
                  <div class="specimens-strip-header">
                    <span>MATCHING ARTWORKS IN "${era.name.toUpperCase()}" → ${activeTypoObj.label} (${matchingWorks.length})</span>
                    <button type="button" class="btn-micro" style="border: 1px solid var(--border-hairline); background: var(--bg-surface); color: var(--text-secondary); cursor: pointer; padding: 2px 8px; font-family: var(--font-mono); font-size: 9px;" data-reset-era="${era.id}">
                      RESET TO ALL [×]
                    </button>
                  </div>
                  <div class="specimens-mini-grid">
                    ${renderSpecimenCards(matchingWorks)}
                  </div>
                </div>
              </div>
            </section>
          `;
        });

        html += `</div>`;
        appRoot.innerHTML = html;

        // Initialize gliders & scroll indicators on all typology strips
        appRoot.querySelectorAll('.typology-strip').forEach(strip => {
          positionTypoGlider(strip, false);
          setupTypologyScrollIndicators(strip);
        });

        // Keep the mobile drawer exactly as tall as the tiles column (rotation, font load, pill widths)
        tilesResizeObserver?.disconnect();
        tilesResizeObserver = new ResizeObserver(entries => {
          const isMobile = window.matchMedia('(max-width: 768px)').matches;
          for (const entry of entries) {
            const strip = entry.target.closest('.era-catalogue-block')?.querySelector('.filtered-specimens-strip');
            if (!strip) continue;
            strip.style.maxHeight =
              isMobile && strip.classList.contains('visible') ? `${entry.target.offsetHeight}px` : '';
          }
        });
        appRoot.querySelectorAll('.category-tiles-grid').forEach(g => tilesResizeObserver.observe(g));

        // Seamless In-Place Typology Filter Click Handlers
        appRoot.querySelectorAll('.typo-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const eraId = btn.dataset.era;
            const key = btn.dataset.key;
            if (!eraId || !key) return;
            updateEraTypology(eraId, key, btn, e);
          });
        });

        // Reset Era buttons
        appRoot.querySelectorAll('[data-reset-era]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const eraId = btn.dataset.resetEra;
            if (!eraId) return;
            const allBtn = appRoot.querySelector(`.typo-btn[data-era="${eraId}"][data-key="all"]`);
            updateEraTypology(eraId, 'all', allBtn, e);
          });
        });

        bindArchiveSearch(initialQ);
        // Build the search index while the page is idle, so the first keystroke doesn't stall
        (window.requestIdleCallback || (fn => setTimeout(fn, 200)))(() => ArchiveSearch.warm());
      }

      // Categories page search. Results are drawn with the era blocks' own parts — typology
      // contact strip, movement tiles, specimen drawer — and updated IN PLACE on each query:
      // tiles are kept and FLIP-reordered, the drawer rolls to its new length. Nothing big
      // is re-rendered per keystroke (that's what made the old card grid choppy on phones).
      const SEARCH_CARD_CAP = 40;   // specimen cards before "Show all"
      const SEARCH_TILE_CAP = 12;   // movement tiles shown (most matches first)
      function bindArchiveSearch(initialQ) {
        const page = appRoot.querySelector('.categories-page');
        const input = document.getElementById('archive-search-input');
        const panel = document.getElementById('archive-search-results');
        if (!page || !input || !panel) return;

        let activeType = 'all';
        let showAll = false;
        let timer = null;
        let seq = 0;
        let ui = null;                 // skeleton elements, built on first query
        const tilePool = new Map();    // movement id → tile element (reused across queries)
        let lastCardsHTML = null;
        let lastTypesSig = '';

        const syncUrl = q => {
          const hash = q ? `#/categories?q=${encodeURIComponent(q)}` : '#/categories';
          if (location.hash !== hash) history.replaceState(null, '', hash);
        };

        function buildSkeleton() {
          panel.innerHTML = `
            <section class="era-catalogue-block search-catalogue-block">
              <div class="era-catalogue-header-group">
                <div class="era-catalogue-title-row">
                  <div class="era-title-left">
                    <h2 class="era-cat-name search-cat-name"></h2>
                    <button type="button" class="era-portal-link search-clear-link" data-search-clear><span>Clear search ×</span></button>
                  </div>
                  <div class="era-cat-dates tabular search-tally"></div>
                </div>
                <div class="era-typology-bar-zone">
                  <div class="typology-strip-scroll-wrap">
                    <button type="button" class="typo-scroll-arrow typo-scroll-left" aria-label="Previous types">
                      <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 1 1 6 7 11"/></svg>
                    </button>
                    <div class="typology-strip" role="toolbar" aria-label="Filter results by type"></div>
                    <button type="button" class="typo-scroll-arrow typo-scroll-right" aria-label="More types">
                      <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 1 7 6 1 11"/></svg>
                    </button>
                  </div>
                  <div class="typology-status-readout tabular"></div>
                </div>
              </div>
              <p class="search-correction" hidden></p>
              <div class="search-group search-artists" hidden>
                <div class="search-group-title">ARTISTS</div>
                <div class="search-chip-row"></div>
              </div>
              <div class="era-catalogue-split-wrapper has-active-filter">
                <div class="category-tiles-grid search-tiles-grid"></div>
                <div class="filtered-specimens-strip visible">
                  <div class="specimens-strip-header">
                    <span class="search-strip-title"></span>
                    <button type="button" class="btn-micro search-show-all" data-search-more hidden>SHOW ALL</button>
                  </div>
                  <div class="specimens-mini-grid"></div>
                </div>
              </div>
              <p class="search-empty" hidden>Nothing found. Try an artist's surname, a place (“Japan”), a material (“bronze”) or a period (“1800s”, “19th century”).</p>
            </section>`;
          const q = s => panel.querySelector(s);
          ui = {
            title: q('.search-cat-name'), tally: q('.search-tally'),
            strip: q('.typology-strip'), readout: q('.typology-status-readout'),
            note: q('.search-correction'), artists: q('.search-artists'), artistRow: q('.search-artists .search-chip-row'),
            split: q('.era-catalogue-split-wrapper'), tiles: q('.search-tiles-grid'),
            drawer: q('.filtered-specimens-strip'), drawerTitle: q('.search-strip-title'),
            more: q('.search-show-all'), cards: q('.specimens-mini-grid'), empty: q('.search-empty'),
          };
          setupTypologyScrollIndicators(ui.strip);
          tilePool.clear();
          lastCardsHTML = null;
          lastTypesSig = '';
        }

        function makeTile(m) {
          const a = document.createElement('a');
          a.className = 'cat-square-tile';
          a.dataset.subId = m.id;
          a.innerHTML = `
            <div class="cat-tile-ghost-img"></div>
            <div class="cat-tile-top"><div class="cat-tile-dates tabular">${formatEraOrMovementDates(m)}</div></div>
            <div class="cat-tile-bottom">
              <span class="cat-tile-active-pill"></span>
              <h3 class="cat-tile-name">${m.name}</h3>
              <div class="cat-tile-count tabular"></div>
            </div>`;
          return a;
        }

        function typoButtons(all, typeCounts) {
          const buttons = [{ key: 'all', label: 'ALL', count: all.length }];
          TYPOLOGY_ORDER.forEach(t => { if (typeCounts.get(t)) buttons.push({ key: t, label: t.toUpperCase(), count: typeCounts.get(t) }); });
          typeCounts.forEach((n, t) => { if (!TYPOLOGY_ORDER.includes(t)) buttons.push({ key: t, label: t.toUpperCase(), count: n }); });
          return buttons;
        }

        function renderTypes(buttons) {
          const sig = buttons.map(b => b.key + ':' + b.count).join('|');
          const rebuilt = sig !== lastTypesSig;
          if (rebuilt) {
            lastTypesSig = sig;
            ui.strip.innerHTML = buttons.map((b, i) => `
              <button type="button" class="typo-btn tabular" data-key="${escapeAttr(b.key)}" aria-pressed="false">
                <span class="typo-idx">${String(i).padStart(2, '0')}</span>
                <span class="typo-label">${escapeAttr(b.label)}</span>
                <span class="typo-count">${b.count}</span>
              </button>`).join('');
            ui.strip.scrollLeft = 0;
            ui.strip.dispatchEvent(new Event('scroll')); // refresh the chevrons
          }
          ui.strip.querySelectorAll('.typo-btn').forEach(b => {
            const on = b.dataset.key === activeType;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
          });
          positionTypoGlider(ui.strip, !rebuilt); // glide only between buttons that stayed put
        }

        function run({ roll = false } = {}) { // roll: full drawer roll (clicks); typing uses a cheap crossfade
          const q = input.value.trim();
          const mySeq = ++seq;
          const isStale = () => seq !== mySeq || !document.body.contains(panel);
          syncUrl(q);
          page.classList.toggle('is-searching', !!q);
          // One Latin letter matches nearly everything: wait for a second one (CJK searches from one)
          const tooShort = q.length < 2 && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(q);
          if (!q || tooShort) { panel.hidden = true; page.classList.remove('is-searching'); return; }
          panel.hidden = false;
          if (!ui || !panel.contains(ui.title)) buildSkeleton();

          const { results, corrected } = ArchiveSearch.search(q);
          const all = results.map(r => r.w);
          const typeCounts = new Map();
          all.forEach(w => { const t = w.type || 'Painting'; typeCounts.set(t, (typeCounts.get(t) || 0) + 1); });
          if (activeType !== 'all' && !typeCounts.has(activeType)) activeType = 'all';
          const works = activeType === 'all' ? all : all.filter(w => (w.type || 'Painting') === activeType);
          const typeLabel = activeType === 'all' ? '' : activeType.toUpperCase();

          // Header: the query is the block's title, like an era name
          ui.title.textContent = `“${q}”`;
          const movIds = new Map();
          works.forEach(w => movIds.set(w.movement_id, (movIds.get(w.movement_id) || 0) + 1));
          swapText(ui.tally, `${works.length}${activeType === 'all' ? '' : '/' + all.length} ${works.length === 1 ? 'WORK' : 'WORKS'} · ${movIds.size} ${movIds.size === 1 ? 'MOVEMENT' : 'MOVEMENTS'}`);

          const buttons = typoButtons(all, typeCounts);
          renderTypes(buttons);
          swapText(ui.readout, activeType === 'all'
            ? `PRESENT TYPES: <strong>${buttons.length - 1}</strong>`
            : `ACTIVE: <strong>${escapeAttr(typeLabel)}</strong> [${String(works.length).padStart(2, '0')}]`, true);

          ui.note.hidden = !corrected.length;
          if (corrected.length) ui.note.innerHTML = `No exact match. Showing results for ${corrected.map(([, to]) => `<em>${escapeAttr(to)}</em>`).join(', ')}.`;

          // Artists: only the ones the query actually names
          const qWords = ArchiveSearch.fold(q).split(' ').filter(t => t.length > 2);
          const artistCounts = new Map();
          all.forEach(w => { if (!ArchiveSearch.isAnonymous(w.artist)) artistCounts.set(w.artist, (artistCounts.get(w.artist) || 0) + 1); });
          const artists = [...artistCounts.entries()]
            .filter(([name]) => { const parts = ArchiveSearch.fold(name).split(' '); return qWords.some(t => parts.some(p => p.startsWith(t))); })
            .sort((a, b) => b[1] - a[1]).slice(0, 8);
          ui.artists.hidden = !artists.length || /^artist:/i.test(q);
          ui.artistRow.innerHTML = artists.map(([name, n]) =>
            `<button type="button" class="search-chip" data-search-artist="${escapeAttr(name)}"><span class="search-chip-label">${escapeAttr(name)}</span><span class="search-chip-count tabular">${n}</span></button>`).join('');

          ui.empty.hidden = all.length > 0;
          ui.split.hidden = all.length === 0;
          if (!all.length) { lastCardsHTML = ''; ui.cards.innerHTML = ''; return; }

          // Movement tiles: most matches first, reused + FLIP-reordered
          const ranked = [...movIds.entries()]
            .map(([id, n]) => ({ m: categoryMap.get(id), n }))
            .filter(x => x.m)
            .sort((a, b) => b.n - a.n || a.m.start_year - b.m.start_year)
            .slice(0, SEARCH_TILE_CAP);
          const qParam = `?q=${encodeURIComponent(q)}${activeType === 'all' ? '' : '&type=' + encodeURIComponent(activeType)}`;
          const entering = [];
          flipTiles(ui.tiles, () => {
            const keep = new Set(ranked.map(x => x.m.id));
            [...ui.tiles.children].forEach(t => { if (!keep.has(t.dataset.subId)) t.remove(); });
            ranked.forEach(({ m, n }, i) => {
              let tile = tilePool.get(m.id);
              if (!tile) { tile = makeTile(m); tilePool.set(m.id, tile); }
              if (!tile.isConnected) { ui.tiles.appendChild(tile); entering.push(tile); }
              tile.style.order = String(i);
              tile.href = `#/category/${m.id}${qParam}`;
              const cover = works.find(w => w.movement_id === m.id);
              const img = cover ? (localUrl(cover, cover.image_url, 400) || getOptimizedImageUrl(cover.thumb_url || cover.image_url, 400)) : '';
              const ghost = tile.querySelector('.cat-tile-ghost-img');
              if (ghost.dataset.src !== img) { ghost.dataset.src = img; ghost.style.backgroundImage = img ? `url('${img}')` : ''; }
              const countEl = tile.querySelector('.cat-tile-count');
              const countText = `[ ${n} ${n === 1 ? 'WORK' : 'WORKS'} MATCHING ]`;
              if (entering.includes(tile)) countEl.textContent = countText; else swapText(countEl, countText);
              setTileActivePill(tile, typeLabel);
            });
          });
          if (!Motion.reduced) entering.forEach((t, i) => t.animate(
            [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
            { duration: Motion.dur('base'), easing: Motion.ease.out, delay: Math.min(i, 8) * 24, fill: 'backwards' }));

          // Specimen drawer
          const cap = showAll ? works.length : SEARCH_CARD_CAP;
          swapText(ui.drawerTitle, `MATCHING ARTWORKS${typeLabel ? ' → ' + typeLabel : ''} (${works.length})`);
          ui.more.hidden = works.length <= cap;
          if (!ui.more.hidden) ui.more.textContent = `SHOW ALL ${works.length}`;
          const html = renderSpecimenCards(works.slice(0, cap));
          if (html !== lastCardsHTML) {
            const first = lastCardsHTML === null || lastCardsHTML === '';
            lastCardsHTML = html;
            if (first) { ui.cards.innerHTML = html; revealStrip(ui.drawer, ui.cards); }
            else if (roll) swapMiniGrid(ui.drawer, ui.cards, html, isStale);
            else { cancelAnims(ui.drawer); ui.drawer.classList.remove('is-rolling'); ui.cards.innerHTML = html; staggerCards(ui.cards, 8); }
          }
        }

        const runNow = opts => { clearTimeout(timer); run(opts); };
        function setQuery(q, { focus = false } = {}) {
          input.value = q;
          activeType = 'all';
          showAll = false;
          runNow();
          if (focus) input.focus();
        }

        input.addEventListener('input', () => {
          clearTimeout(timer);
          showAll = false;
          timer = setTimeout(run, 180);
        });
        input.addEventListener('keydown', e => {
          if (e.key === 'Escape') { e.preventDefault(); setQuery(''); }
          if (e.key === 'Enter') { runNow(); input.blur(); }
        });

        page.addEventListener('click', e => {
          const hint = e.target.closest('[data-q]');
          if (hint) { setQuery(hint.dataset.q); return; }
          const artist = e.target.closest('[data-search-artist]');
          if (artist) { setQuery(`artist:"${artist.dataset.searchArtist.replace(/"/g, '')}"`); return; }
          const typo = e.target.closest('.search-catalogue-block .typo-btn');
          if (typo) {
            if (typo.dataset.key === activeType) return;
            activeType = typo.dataset.key;
            showAll = false;
            runNow({ roll: true });
            positionTypoGlider(ui.strip, true);
            typo.scrollIntoView({ behavior: Motion.scroll(), block: 'nearest', inline: 'nearest' });
            return;
          }
          if (e.target.closest('[data-search-more]')) { showAll = true; runNow({ roll: true }); return; }
          if (e.target.closest('[data-search-clear]')) { setQuery('', { focus: true }); }
        });

        // "/" focuses the search from anywhere on the page
        if (window.currentCategoriesKeyHandler) window.removeEventListener('keydown', window.currentCategoriesKeyHandler);
        window.currentCategoriesKeyHandler = e => {
          if (!document.body.contains(input)) {
            window.removeEventListener('keydown', window.currentCategoriesKeyHandler);
            window.currentCategoriesKeyHandler = null;
            return;
          }
          if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
            e.preventDefault();
            input.focus();
            input.select();
          }
        };
        window.addEventListener('keydown', window.currentCategoriesKeyHandler);

        panel.hidden = !initialQ;
        if (initialQ) run();
      }

      // ----- Motion helpers (Web Animations; no inline styles left behind) -----

      /**
       * FLIP: animate tiles from their previous on-screen box to their new layout box.
       * Measures BEFORE cancelling in-flight animations, so an interrupted move continues
       * from where it visually is. Tiles are 1:1 (aspect-ratio), so a uniform scale is
       * safe for the mobile 2-col → 1-col switch.
       */
      function flipTiles(grid, mutate, { heightEl = null } = {}) {
        if (!grid) { mutate(); return; }
        const tiles = [...grid.children];
        if (Motion.reduced) { mutate(); return; }

        // Scroll anchoring would shift the page between our measurement and the first
        // painted frame (big layout swaps like 1-col → 2-col on mobile), making every
        // tile jump by that offset. Suspend it for the duration of the move.
        const root = document.documentElement;
        root.style.overflowAnchor = 'none';

        const first = new Map(tiles.map(t => [t, t.getBoundingClientRect()]));
        let h0 = 0;
        if (heightEl) { cancelAnims(heightEl); h0 = heightEl.getBoundingClientRect().height; }
        tiles.forEach(cancelAnims);
        mutate();

        const dur = Motion.dur('slow');
        const anims = [];
        let i = 0;
        for (const t of tiles) {
          const f = first.get(t);
          const l = t.getBoundingClientRect();
          if (!l.width || !f.width) continue;
          const dx = f.left - l.left;
          const dy = f.top - l.top;
          const s = f.width / l.width;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.01) continue;
          anims.push(t.animate(
            [
              { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${s})` },
              { transformOrigin: '0 0', transform: 'none' },
            ],
            // 'backwards' holds the start pose during the stagger delay; without it a
            // delayed tile flashes at its destination, then snaps back to start moving.
            { duration: dur, easing: Motion.ease.out, delay: Math.min(i++ * 14, 112), fill: 'backwards' }
          ));
        }

        // Glide the container's height too, so content below doesn't snap up/down
        // (and the page can't clamp its scroll) while the tiles are still travelling.
        if (heightEl) {
          const h1 = heightEl.getBoundingClientRect().height;
          if (Math.abs(h1 - h0) > 1) {
            anims.push(heightEl.animate(
              [{ height: `${h0}px` }, { height: `${h1}px` }],
              { duration: dur + Math.min(i * 14, 112), easing: Motion.ease.out }
            ));
          }
        }

        const token = (flipTiles._token = (flipTiles._token || 0) + 1);
        Promise.allSettled(anims.map(a => a.finished)).then(() => {
          if (flipTiles._token === token) root.style.overflowAnchor = '';
        });
      }

      function stripBoxKeyframes(strip, open) {
        const cs = getComputedStyle(strip);
        const full = {
          height: `${strip.offsetHeight}px`,
          paddingTop: cs.paddingTop,
          paddingBottom: cs.paddingBottom,
          marginTop: cs.marginTop,
          opacity: 1,
        };
        const zero = { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', opacity: 0 };
        return open ? [zero, full] : [full, zero];
      }

      /*
       * Specimen drawer "window shade": the strip's bottom edge rolls down/up at a pace
       * proportional to the distance, and each card enters (or leaves) at the moment the
       * edge passes it, so cards ride the edge instead of fading on an unrelated timer.
       */
      const ROLL_EASE = 'cubic-bezier(0.33, 0, 0.2, 1)';
      const rollDur = dh => (Motion.reduced ? 0 : Math.round(Math.min(620, Math.max(280, 220 + Math.abs(dh) * 0.7))));
      // Inverse of ROLL_EASE: for an edge progress fraction, the time fraction at which the edge gets there
      const rollEaseInverse = (() => {
        const [x1, y1, x2, y2] = [0.33, 0, 0.2, 1];
        const pts = [];
        for (let i = 0; i <= 48; i++) {
          const s = i / 48, u = 1 - s;
          pts.push([3 * u * u * s * x1 + 3 * u * s * s * x2 + s ** 3, 3 * u * u * s * y1 + 3 * u * s * s * y2 + s ** 3]);
        }
        return y => {
          if (y <= 0) return 0;
          if (y >= 1) return 1;
          for (let i = 1; i < pts.length; i++) {
            if (pts[i][1] >= y) {
              const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
              return ax + (bx - ax) * ((y - ay) / ((by - ay) || 1));
            }
          }
          return 1;
        };
      })();

      /** Cards drop into place top → bottom as the edge sweeps from `sweepFrom` to `sweepTo` px. */
      function rollCardsIn(miniGrid, strip, sweepFrom, sweepTo, dur) {
        if (Motion.reduced || !miniGrid) return;
        const top = strip.getBoundingClientRect().top;
        const span = Math.max(1, sweepTo - sweepFrom);
        [...miniGrid.children].forEach(card => {
          const r = card.getBoundingClientRect();
          const p = Math.min(Math.max((r.top - top + r.height * 0.5 - sweepFrom) / span, 0), 1);
          card.animate(
            [{ opacity: 0, transform: 'translateY(-14px)' }, { opacity: 1, transform: 'none' }],
            {
              duration: Motion.dur('slow'),
              easing: Motion.ease.out,
              delay: Math.max(0, rollEaseInverse(p) * dur - 60),
              fill: 'backwards',
            }
          );
        });
      }

      /** Cards lift away bottom → top over `dur`. Returns their animations. */
      function rollCardsOut(miniGrid, strip, dur) {
        if (Motion.reduced || !miniGrid) return [];
        const top = strip.getBoundingClientRect().top;
        const H = strip.offsetHeight || 1;
        const each = Motion.dur('fast');
        return [...miniGrid.children].map(card => {
          const r = card.getBoundingClientRect();
          const y = Math.min(Math.max(r.top - top, 0), H);
          const fromOpacity = getComputedStyle(card).opacity;
          cancelAnims(card);
          return card.animate(
            [{ opacity: fromOpacity, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }],
            { duration: each, easing: Motion.ease.in, delay: (1 - y / H) * Math.max(0, dur - each), fill: 'both' }
          );
        });
      }

      function endRoll(strip, anim) {
        anim.finished.then(() => strip.classList.remove('is-rolling')).catch(() => {});
      }

      /** Call AFTER .visible is applied and layout is final. Rolls the drawer down, cards riding the edge. */
      function revealStrip(strip, miniGrid) {
        cancelAnims(strip);
        if (Motion.reduced) return;
        const h = strip.offsetHeight;
        const dur = rollDur(h);
        strip.classList.add('is-rolling');
        endRoll(strip, strip.animate(stripBoxKeyframes(strip, true), { duration: dur, easing: ROLL_EASE }));
        rollCardsIn(miniGrid, strip, 0, h, dur);
      }

      /** Rolls the drawer up, cards lifting away bottom-first. Resolves when done; the caller removes .visible. */
      function concealStrip(strip, miniGrid) {
        cancelAnims(strip);
        if (Motion.reduced || !strip.classList.contains('visible')) return Promise.resolve();
        const dur = rollDur(strip.offsetHeight);
        rollCardsOut(miniGrid, strip, dur);
        strip.classList.add('is-rolling');
        const anim = strip.animate(stripBoxKeyframes(strip, false), { duration: dur, easing: ROLL_EASE, fill: 'forwards' });
        anim.id = 'strip-exit';
        return anim.finished.catch(() => {});
      }

      function staggerCards(container, cap = 10) {
        if (Motion.reduced) return;
        [...container.children].forEach((card, i) => {
          card.animate(
            [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
            {
              duration: Motion.dur('base'),
              easing: Motion.ease.out,
              delay: Math.min(i, cap) * 24,
              fill: 'backwards',
            }
          );
        });
      }

      /** Natural height the strip would have with `html` as its cards (synchronous, never painted). */
      function measureStripWith(strip, miniGrid, html) {
        const old = document.createDocumentFragment();
        while (miniGrid.firstChild) old.appendChild(miniGrid.firstChild);
        miniGrid.innerHTML = html;
        const h = strip.offsetHeight;
        miniGrid.replaceChildren(old);
        return h;
      }

      /**
       * Filter → filter, one continuous shade:
       *  A. old cards lift away bottom-first; if the drawer gets shorter, its edge rolls up with them
       *  B. new cards go in; if the drawer gets longer, its edge rolls down and the cards ride it
       */
      async function swapMiniGrid(strip, miniGrid, html, isStale) {
        const fromH = strip.offsetHeight; // the visual height, even mid-roll
        cancelAnims(strip);
        cancelAnims(miniGrid);
        if (Motion.reduced) { miniGrid.innerHTML = html; return; }

        const toH = measureStripWith(strip, miniGrid, html);
        const shrink = toH < fromH - 1;
        const durA = shrink ? rollDur(fromH - toH) : Motion.dur('base');
        strip.classList.add('is-rolling');
        const hold = strip.animate(
          [{ height: `${fromH}px` }, { height: `${shrink ? toH : fromH}px` }],
          { duration: durA, easing: ROLL_EASE, fill: 'forwards' }
        );
        const outs = rollCardsOut(miniGrid, strip, durA);
        await Promise.all([hold, ...outs].map(a => a.finished)).catch(() => {});
        if (isStale()) return;

        const startH = shrink ? toH : fromH;
        miniGrid.innerHTML = html;
        cancelAnims(strip); // drop the hold; the strip is now at its natural (new) height
        const endH = strip.offsetHeight;
        const grow = endH > startH + 1;
        const durB = rollDur(endH - startH);
        if (Math.abs(endH - startH) >= 2) {
          endRoll(strip, strip.animate([{ height: `${startH}px` }, { height: `${endH}px` }], { duration: durB, easing: ROLL_EASE }));
        } else {
          strip.classList.remove('is-rolling');
        }
        // Growing: cards ride the descending edge. Same/shorter: they still cascade top → bottom.
        rollCardsIn(miniGrid, strip, grow ? startH : 0, endH, grow ? durB : rollDur(endH) * 0.75);
      }

      /** Archive grid: fade out, swap once the exit has really finished, cascade in. */
      async function swapArchiveGrid(grid, works) {
        const token = (grid._swapToken = (grid._swapToken || 0) + 1);
        cancelAnims(grid);
        if (!Motion.reduced) {
          await grid
            .animate(
              [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(4px)' }],
              { duration: Motion.dur('fast'), easing: Motion.ease.in, fill: 'forwards' }
            )
            .finished.catch(() => {});
          if (grid._swapToken !== token) return;
        }
        grid.innerHTML = renderArtworkGridCards(works);
        cancelAnims(grid);
        window.initCardSliders(grid);
        staggerCards(grid, 12);
      }

      /**
       * Small crossfade so counters and readouts don't flicker when their text changes.
       * Compares against the PENDING target (not the DOM text), so A → B → A in quick
       * succession ends on A. Holds the faded-out frame (fill: forwards) and starts each
       * new fade from the current opacity, so old text never flashes back mid-swap.
       */
      function swapText(el, next, asHTML = false) {
        if (!el) return;
        const shown = asHTML ? el.innerHTML : el.textContent;
        const target = el._swapTarget ?? shown;
        if (target === next) return;
        el._swapTarget = next;

        const write = () => { asHTML ? (el.innerHTML = next) : (el.textContent = next); };
        if (Motion.reduced) { write(); el._swapTarget = undefined; return; }

        const fromOpacity = getComputedStyle(el).opacity;
        cancelAnims(el);
        el.animate([{ opacity: fromOpacity }, { opacity: 0 }], {
          duration: Motion.dur('instant'), easing: Motion.ease.in, fill: 'forwards',
        })
          .finished.then(() => {
            if (el._swapTarget !== next) return; // superseded by a newer call
            write();
            el._swapTarget = undefined;
            cancelAnims(el);
            el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: Motion.dur('fast'), easing: Motion.ease.out });
          })
          .catch(() => {}); // cancelled by a newer call
      }

      function renderSpecimenCards(works) {
        return works.map(w => {
          const thumbUrl = localUrl(w, w.image_url, 140) || getOptimizedImageUrl(w.thumb_url || w.image_url, 140);
          return `
            <a href="#/work/${w.id}" class="specimen-mini-card">
              <div class="specimen-thumb" style="background-image: url('${thumbUrl}');"></div>
              <div class="specimen-info">
                <div class="specimen-inv tabular">${w.inv_number || ''} · ${(w.type || 'Painting').toUpperCase()}</div>
                <div class="specimen-title">${escapeAttr(w.title_eng || w.title)}</div>
                <div class="specimen-medium-raw">${escapeAttr(w.medium || w.date_display || '')}</div>
              </div>
            </a>`;
        }).join('');
      }

      // Seamless localized update for an era without full page reload
      async function updateEraTypology(eraId, key, clickedBtn, e) {
        if (categoryTypologyState[eraId] === key) return;
        const block = appRoot.querySelector(`[data-era-block="${eraId}"]`);
        if (!block) return;

        categoryTypologyState[eraId] = key;
        const eraWorks = artworks.filter(w => w.era_id === eraId);
        const movements = categories.filter(c => c.parent_id === eraId);
        const era = categoryMap.get(eraId);

        // 1. Update Buttons & Glider in strip
        const strip = block.querySelector('.typology-strip');
        if (strip) {
          strip.querySelectorAll('.typo-btn').forEach(b => {
            const isAct = b.dataset.key === key;
            b.classList.toggle('active', isAct);
            b.setAttribute('aria-pressed', isAct);
          });
          positionTypoGlider(strip, true);
          const actBtn = strip.querySelector('.typo-btn.active');
          if (actBtn) {
            actBtn.scrollIntoView({ behavior: Motion.scroll(), block: 'nearest', inline: 'nearest' });
          }
        }

        // Easter eggs run first so the awaits below never delay them
        // Ghost paw trigger (2% chance)
        if (e && (Math.random() < 0.02 || e.altKey)) {
          spawnGhostPaw(e.clientX || (window.innerWidth / 2), e.clientY || (window.innerHeight / 2));
        }
        // Persona 5 vocalisation trigger (1% chance)
        if (clickedBtn && (Math.random() < 0.01 || (e && e.shiftKey))) {
          spawnPersona5ShibuyaVocalisation(clickedBtn);
        }

        // 2. Matching works
        const matchingWorks = key === 'all' ? eraWorks : eraWorks.filter(w => (w.type || 'Painting') === key);

        // 3. Update Title Dates / Works count
        const datesEl = block.querySelector('.era-cat-dates');
        if (datesEl && era) {
          swapText(datesEl, `${formatEraOrMovementDates(era)} · [${matchingWorks.length}/${eraWorks.length} WORKS]`);
        }

        // 4. Update Readout
        const readout = block.querySelector('.typology-status-readout');
        if (readout) {
          const actLabel = key === 'all' ? 'ALL' : key.toUpperCase();
          swapText(readout, key === 'all'
            ? `PRESENT TYPES: <strong>${(strip ? strip.querySelectorAll('.typo-btn').length : 1) - 1}</strong>`
            : `ACTIVE: <strong>${actLabel}</strong> [${String(matchingWorks.length).padStart(2, '0')}]`, true);
        }

        // 5. Update era portal link
        const portalLink = block.querySelector(`[data-era-link="${eraId}"]`);
        if (portalLink) {
          portalLink.href = key === 'all' ? `#/category/${eraId}` : `#/category/${eraId}?type=${encodeURIComponent(key)}`;
        }

        // --- 6+7. Tiles + strip, orchestrated ---
        // A per-block sequence token lets rapid clicks cancel stale work.
        const seq = (block._typoSeq = (block._typoSeq || 0) + 1);
        const isStale = () => block._typoSeq !== seq;

        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const splitWrapper = block.querySelector('.era-catalogue-split-wrapper');
        const specStrip = block.querySelector('.filtered-specimens-strip');
        const miniGrid = specStrip?.querySelector('.specimens-mini-grid');
        const tilesGrid = block.querySelector('.category-tiles-grid');
        if (!splitWrapper || !specStrip || !miniGrid) return;
        cancelAnims(splitWrapper); // drop a still-running height glide from a previous close

        // Clear anything an older implementation may have left inline
        specStrip.style.height = '';
        specStrip.style.transition = '';

        const wasActive = splitWrapper.classList.contains('has-active-filter');
        const willBeActive = key !== 'all';

        const updateTiles = () => {
          if (!tilesGrid) return;
          movements.forEach(m => {
            const tile = tilesGrid.querySelector(`[data-sub-id="${m.id}"]`);
            if (!tile) return;
            const subAll = eraWorks.filter(w => w.movement_id === m.id);
            const subFiltered = willBeActive ? subAll.filter(w => (w.type || 'Painting') === key) : subAll;
            const count = subFiltered.length;

            tile.href = willBeActive
              ? `#/category/${m.id}?type=${encodeURIComponent(key)}`
              : `#/category/${m.id}`;
            tile.classList.toggle('is-filtered-out', count === 0);
            tile.style.order = willBeActive ? (count > 0 ? String(m.start_year) : '1000000') : '';

            if (tile.querySelector('.cat-tile-active-pill')) {
              setTileActivePill(tile, willBeActive && count > 0 ? key : '');
            }
            swapText(
              tile.querySelector('.cat-tile-count'),
              `[ ${count} ${count === 1 ? 'WORK' : 'WORKS'} ${willBeActive ? 'MATCHING' : 'CATALOGUED'} ]`
            );
          });
        };

        if (willBeActive && era) {
          swapText(
            specStrip.querySelector('.specimens-strip-header span'),
            `MATCHING ARTWORKS IN "${era.name.toUpperCase()}" → ${key.toUpperCase()} (${matchingWorks.length})`
          );
        }
        const cardsHTML = willBeActive ? renderSpecimenCards(matchingWorks) : '';

        // Mobile: cap the drawer at the tiles column height NOW (the ResizeObserver only runs
        // after this task), so the roll is measured against the final height and never snaps.
        const syncStripMax = () => {
          specStrip.style.maxHeight = isMobile && specStrip.classList.contains('visible') && tilesGrid
            ? `${tilesGrid.offsetHeight}px` : '';
        };

        if (willBeActive && !wasActive) {
          // OPEN: re-layout tiles (FLIP), then roll the drawer down with the cards riding its edge
          cancelAnims(miniGrid);
          flipTiles(tilesGrid, () => {
            updateTiles();
            splitWrapper.classList.add('has-active-filter');
            specStrip.classList.add('visible');
            miniGrid.innerHTML = cardsHTML;
            syncStripMax();
          });
          revealStrip(specStrip, miniGrid);

        } else if (willBeActive && wasActive) {
          // FILTER → FILTER: tiles reorder in place; the drawer rolls to its new length.
          // If it's mid-exit (a close was clicked, then a type), its forwards fill would leave
          // it at zero height: swap the cards and roll it back down instead.
          const exiting = specStrip.getAnimations().some(a => a.id === 'strip-exit');
          flipTiles(tilesGrid, () => { updateTiles(); syncStripMax(); });
          if (exiting) {
            miniGrid.innerHTML = cardsHTML;
            revealStrip(specStrip, miniGrid); // cancels the exit first
          } else {
            swapMiniGrid(specStrip, miniGrid, cardsHTML, isStale);
          }

        } else if (!willBeActive && wasActive) {
          // CLOSE
          const finishClose = () => {
            specStrip.classList.remove('visible', 'is-rolling');
            splitWrapper.classList.remove('has-active-filter');
            specStrip.style.maxHeight = '';
            cancelAnims(specStrip);
            cancelAnims(miniGrid);
          };
          if (isMobile) {
            // Drawer rolls up first, then the tiles expand back to the multi-column grid
            await concealStrip(specStrip, miniGrid);
            if (isStale()) return;
            flipTiles(tilesGrid, () => {
              updateTiles();
              finishClose();
            }, { heightEl: splitWrapper });
          } else {
            // Desktop: the tiles reorder while the drawer rolls up underneath them
            flipTiles(tilesGrid, updateTiles);
            await concealStrip(specStrip, miniGrid);
            if (isStale()) return;
            finishClose();
          }

        } else {
          flipTiles(tilesGrid, updateTiles);
        }
      }

      function renderCategorySquareTile(cat, count) {
        let titleArt = artworkSlugMap.get(cat.title_artwork_id);
        if (!titleArt) {
          titleArt = artworks.find(w => w.movement_id === cat.id || w.era_id === cat.id);
        }
        const bgImg = titleArt
          ? (localUrl(titleArt, titleArt.image_url, 400) || getOptimizedImageUrl(titleArt.thumb_url || titleArt.image_url, 400))
          : '';

        return `
          <a href="#/category/${cat.id}" class="cat-square-tile">
            ${bgImg ? `<div class="cat-tile-ghost-img" style="background-image: url('${bgImg}');"></div>` : ''}
            <div class="cat-tile-top">
              <div class="cat-tile-dates">${cat.start_year < 0 ? Math.abs(cat.start_year) + ' BCE' : cat.start_year + ' CE'} — ${cat.end_year < 0 ? Math.abs(cat.end_year) + ' BCE' : cat.end_year + ' CE'}</div>
            </div>
            <div class="cat-tile-bottom">
              <h3 class="cat-tile-name">${cat.name}</h3>
              <div class="cat-tile-count">[ ${count} WORKS CATALOGUED ]</div>
            </div>
          </a>
        `;
      }

      // 6. VIEW: CATEGORY & SUBCATEGORY DETAIL GRID (#/category/<id>)
      function renderCategoryDetailView(catId, query = {}) {
        const cleanId = (catId || '').split('?')[0];
        const category = categoryMap.get(cleanId);
        if (!category) {
          appRoot.innerHTML = `<div style="padding: 64px 32px; text-align: center;"><h2>Category not found</h2><p><a href="#/categories">Back to Categories</a></p></div>`;
          return;
        }

        const parentEra = category.parent_id ? categoryMap.get(category.parent_id) : null;
        const subCategories = categories.filter(c => c.parent_id === category.id);
        const allCategoryArtworks = artworks.filter(w => w.era_id === category.id || w.movement_id === category.id);
        const activeEraId = category.level === 'era' ? category.id : category.parent_id;
        if (activeEraId) setActiveEra(activeEraId);

        // Calculate counts by type for this category/subcategory
        const typeCounts = { all: allCategoryArtworks.length };
        allCategoryArtworks.forEach(w => {
          const t = w.type || 'Painting';
          typeCounts[t] = (typeCounts[t] || 0) + 1;
        });

        // Build typology buttons dynamically
        const buttons = [
          { key: 'all', label: 'ALL', count: allCategoryArtworks.length }
        ];

        TYPOLOGY_ORDER.forEach(t => {
          if (typeCounts[t] && typeCounts[t] > 0) {
            buttons.push({
              key: t,
              label: t.toUpperCase(),
              count: typeCounts[t]
            });
          }
        });

        // Determine active filter (from query string or stored state)
        let activeFilter = (query && query.type) ? query.type : (categoryTypologyState[cleanId] || 'all');
        if (activeFilter !== 'all' && !buttons.some(b => b.key.toLowerCase() === activeFilter.toLowerCase())) {
          activeFilter = 'all';
        } else if (activeFilter !== 'all') {
          const matchedBtn = buttons.find(b => b.key.toLowerCase() === activeFilter.toLowerCase());
          if (matchedBtn) activeFilter = matchedBtn.key;
        }
        categoryTypologyState[cleanId] = activeFilter;

        const activeTypoObj = buttons.find(b => b.key === activeFilter) || buttons[0];
        const initialFilteredWorks = activeFilter === 'all'
          ? allCategoryArtworks
          : allCategoryArtworks.filter(w => (w.type || 'Painting') === activeFilter);

        let html = `
          <div class="category-page-view">
            <header class="category-view-hero">
              <div class="cat-breadcrumb-row">
                <a href="#/categories">CATEGORIES</a>
                ${parentEra ? ` › <a href="#/category/${parentEra.id}${activeFilter !== 'all' ? '?type=' + encodeURIComponent(activeFilter) : ''}">${parentEra.name.toUpperCase()}</a>` : ''}
                › ${category.name.toUpperCase()}
              </div>
              <h1 class="category-view-title">${category.name}</h1>
              <div class="category-view-dates">
                ${category.start_year < 0 ? Math.abs(category.start_year) + ' BCE' : category.start_year + ' CE'} — ${category.end_year < 0 ? Math.abs(category.end_year) + ' BCE' : category.end_year + ' CE'}
              </div>
              <p class="category-view-intro">${category.introduction}</p>
            </header>
        `;

        // Sub-categories / Movements inside this Era
        if (subCategories.length > 0) {
          html += `
            <div style="margin-bottom: 30px;">
              <h3 style="text-align: center; font-family: var(--font-ui); font-size: 12px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; margin-bottom: 20px;">
                SUB-MOVEMENTS &amp; SCHOOLS
              </h3>
              <div class="sub-category-tiles-wrap">
                ${subCategories.map(sub => {
                  const subAll = artworks.filter(w => w.movement_id === sub.id);
                  const subFiltered = activeFilter === 'all'
                    ? subAll
                    : subAll.filter(w => (w.type || 'Painting') === activeFilter);
                  const count = subFiltered.length;
                  const isFilteredOut = count === 0;

                  let titleArt = artworkSlugMap.get(sub.title_artwork_id) || subFiltered[0] || subAll[0];
                  const bgImg = titleArt
                    ? (localUrl(titleArt, titleArt.image_url, 400) || getOptimizedImageUrl(titleArt.thumb_url || titleArt.image_url, 400))
                    : '';

                  const subUrl = activeFilter === 'all'
                    ? `#/category/${sub.id}`
                    : `#/category/${sub.id}?type=${encodeURIComponent(activeFilter)}`;

                  const tileOrder = (activeFilter !== 'all')
                    ? (count > 0 ? `order: ${sub.start_year};` : 'order: 1000000;')
                    : '';

                  return `
                    <a href="${subUrl}" class="cat-square-tile ${isFilteredOut ? 'is-filtered-out' : ''}" data-sub-id="${sub.id}" style="${tileOrder}">
                      ${bgImg ? `<div class="cat-tile-ghost-img" style="background-image: url('${bgImg}');"></div>` : ''}
                      <div class="cat-tile-top">
                        <div class="cat-tile-dates tabular">${formatEraOrMovementDates(sub)}</div>
                      </div>
                      <div class="cat-tile-bottom">
                        <span class="cat-tile-active-pill ${activeFilter !== 'all' && count > 0 ? 'visible' : ''}" ${activeFilter !== 'all' && count > 0 ? `data-current-type="${escapeAttr(activeTypoObj.label)}"` : ''}>
                          ${activeFilter !== 'all' && count > 0 ? `<span class="pill-roller"><span class="pill-text">${activeTypoObj.label}</span></span>` : ''}
                        </span>
                        <h3 class="cat-tile-name">${sub.name}</h3>
                        <div class="cat-tile-count tabular">
                          [ ${count} ${count === 1 ? 'WORK' : 'WORKS'} ${activeFilter === 'all' ? 'CATALOGUED' : 'MATCHING'} ]
                        </div>
                      </div>
                    </a>
                  `;
                }).join('')}
              </div>
            </div>
            <hr class="basting-rule">
          `;
        }

        // 3. Typology Filter Strip for Categories and Subcategories Page
        html += `
          <div class="era-typology-bar-zone" style="margin-top: 14px; margin-bottom: 22px;">
            <div class="typology-strip-scroll-wrap">
              <button type="button" class="typo-scroll-arrow typo-scroll-left" aria-label="Previous categories">
                <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 1 1 6 7 11"/></svg>
              </button>
              <div class="typology-strip" role="toolbar" aria-label="${escapeAttr(category.name)} Typology Filter">
                ${buttons.map((btn, idx) => {
                  const isActive = btn.key === activeFilter;
                  const isEmpty = btn.count === 0;
                  return `
                    <button type="button" class="typo-btn tabular ${isActive ? 'active' : ''} ${isEmpty ? 'is-empty' : ''}"
                            data-cat="${category.id}" data-key="${btn.key}" aria-pressed="${isActive}">
                      <span class="typo-idx">${String(idx).padStart(2, '0')}</span>
                      <span class="typo-label">${btn.label}</span>
                      <span class="typo-count">${btn.count}</span>
                    </button>
                  `;
                }).join('')}
              </div>
              <button type="button" class="typo-scroll-arrow typo-scroll-right" aria-label="Next categories">
                <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 1 7 6 1 11"/></svg>
              </button>
            </div>

            <!-- Active Filter Readout -->
            <div class="typology-status-readout tabular">
              ${activeFilter === 'all'
                ? `PRESENT TYPES: <strong>${buttons.length - 1}</strong>`
                : `ACTIVE: <strong>${activeTypoObj.label}</strong> [${String(initialFilteredWorks.length).padStart(2, '0')}]`}
            </div>
          </div>

          <div class="mobile-filter-bar">
            <button class="mobile-filter-trigger" id="open-filter-sheet">
              <span class="inv-stamp">SEARCH &amp; SORT</span>
            </button>
            <div class="results-tally" id="mobile-results-tally">[ ${initialFilteredWorks.length} WORKS ]</div>
          </div>

          <div class="archive-toolbar">
            <div class="toolbar-search-wrap">
              <input type="text" id="cat-search" class="search-input" placeholder="SEARCH ARTIST, TITLE, TYPE, YEAR…">
            </div>

            <div class="toolbar-sort-wrap">
              <label for="cat-sort" style="font-family: var(--font-mono); font-size: 11.5px;">SORT:</label>
              <select id="cat-sort" class="sort-select">
                <option value="year-asc">Chronological (Earliest)</option>
                <option value="year-desc">Chronological (Latest)</option>
                <option value="artist-asc">Artist (A—Z)</option>
                <option value="title-asc">Title (A—Z)</option>
              </select>
            </div>

            <div class="results-tally" id="results-tally">[ ${initialFilteredWorks.length} WORKS CATALOGUED ]</div>
          </div>

          <div class="artwork-grid" id="cat-artwork-grid">
            ${renderArtworkGridCards(initialFilteredWorks)}
          </div>
        </div>
        `;

        appRoot.innerHTML = html;

        // Initialize glider & scroll indicators in category detail view
        const strip = appRoot.querySelector('.typology-strip');
        if (strip) {
          positionTypoGlider(strip, false);
          setupTypologyScrollIndicators(strip);
        }

        bindCategoryControls(category, allCategoryArtworks, activeFilter, buttons, typeCounts, subCategories, (query && query.q) || "");
      }

      function renderArtworkGridCards(works) {
        if (works.length === 0) {
          return `<div style="width: 100%; flex: 0 1 100%; padding: 48px 16px; text-align: center; color: var(--text-secondary); font-family: var(--font-reading);">No artworks match the current query.</div>`;
        }

        return works.map((w, i) => {
          const isWide = (w.aspect_ratio && w.aspect_ratio >= 1.22);
          const aspect = getArtworkAspect(w);
          return `
            <article class="grid-art-card stagger-in ${isWide ? 'is-wide' : ''}" style="--stagger-i:${Math.min(i, 10)}" onclick="window.location.hash='#/work/${w.id}'">
              <div class="grid-card-thumb${lqClass(w)}" style="aspect-ratio: ${aspect};${lqStyle(w)}" data-photo-max-w="${w.max_width || ''}" data-photo-max-h="${w.max_height || ''}">
                ${renderCardMedia(w, 500, isWide ? '(min-width: 641px) 796px, 92vw' : '(min-width: 1060px) 380px, (min-width: 641px) 45vw, 92vw', i < 4)}
              </div>
              <div class="grid-card-meta-wrap">
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                  <span class="inv-stamp">${w.inv_number}</span>
                  <button class="card-stack-btn ${CuratorialStack.has(w.id) ? 'active' : ''}" data-work-id="${w.id}" title="Add to Curatorial Stack" onclick="event.stopPropagation(); window.toggleWorkStack('${w.id}', this);">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="${CuratorialStack.has(w.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                  </button>
                </div>
                <h4 class="card-title-eng">${w.title_eng || w.title}</h4>
                ${w.title_eng && w.title_eng !== workTitle(w) ? `<div class="card-title-orig">${w.title}</div>` : ''}
                <div class="card-artist-meta settle-detail" style="--stagger-i:${Math.min(i, 10)}">${w.artist} · ${w.date_display}</div>
                <div class="card-tags-row settle-detail" style="--stagger-i:${Math.min(i, 10)}">
                  <span class="fabric-tag">${w.culture}</span>
                </div>
              </div>
            </article>
          `;
        }).join('');
      }

      function workTitle(w) {
        return w.title || '';
      }

      function bindCategoryControls(category, allWorks, initialType, buttons, typeCounts, subCategories = [], initialQuery = "") {
        let activeType = initialType || 'all';
        let searchQuery = initialQuery; // arrives pre-filled from a Categories search tile (?q=)
        let sortOption = 'year-asc';

        const searchInput = document.getElementById('cat-search');
        const sortSelect = document.getElementById('cat-sort');
        const grid = document.getElementById('cat-artwork-grid');
        const tally = document.getElementById('results-tally');
        const mobileTally = document.getElementById('mobile-results-tally');
        const strip = appRoot.querySelector('.category-page-view .typology-strip');
        const readout = appRoot.querySelector('.category-page-view .typology-status-readout');
        const subWrap = appRoot.querySelector('.sub-category-tiles-wrap');

        const sheet = document.getElementById('filter-bottom-sheet');
        const openSheetBtn = document.getElementById('open-filter-sheet');
        const closeSheetBtn = document.getElementById('close-filter-sheet');
        const applySheetBtn = document.getElementById('apply-filter-sheet');
        const sheetSearch = document.getElementById('sheet-search');
        const sheetSort = document.getElementById('sheet-sort');

        function update() {
          let filtered = activeType === 'all'
            ? allWorks.slice()
            : allWorks.filter(w => (w.type || 'Painting') === activeType);
          if (searchQuery) {
            // Same engine as the Categories page search (all fields, accents, dates, qualifiers)
            const { results, terms } = ArchiveSearch.search(searchQuery, filtered);
            if (terms.length) filtered = results.map(r => r.w);
          }

          filtered.sort((a, b) => {
            if (sortOption === 'year-asc') return (a.year_sort || 0) - (b.year_sort || 0);
            if (sortOption === 'year-desc') return (b.year_sort || 0) - (a.year_sort || 0);
            if (sortOption === 'artist-asc') return (a.artist || '').localeCompare(b.artist || '');
            if (sortOption === 'title-asc') return (a.title || '').localeCompare(b.title || '');
            return 0;
          });

          if (grid) swapArchiveGrid(grid, filtered);

          const baseCount = activeType === 'all' ? allWorks.length : (typeCounts[activeType] || 0);
          const tallyText = `[ ${filtered.length} / ${baseCount} WORKS ]`;
          swapText(tally, tallyText);
          swapText(mobileTally, tallyText);
        }

        // Typology Strip Click Handlers in Category View
        if (strip) {
          strip.querySelectorAll('.typo-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              const key = btn.dataset.key;
              if (!key || key === activeType) return;
              activeType = key;
              categoryTypologyState[category.id] = key;

              // Smoothly glide active state along the row
              strip.querySelectorAll('.typo-btn').forEach(b => {
                const isAct = b.dataset.key === key;
                b.classList.toggle('active', isAct);
                b.setAttribute('aria-pressed', isAct);
              });
              positionTypoGlider(strip, true);
              btn.scrollIntoView({ behavior: Motion.scroll(), block: 'nearest', inline: 'nearest' });

              // Update URL hash seamlessly without navigation reload
              const newHash = key === 'all'
                ? `#/category/${category.id}`
                : `#/category/${category.id}?type=${encodeURIComponent(key)}`;
              history.replaceState(null, '', newHash);

              // Update Readout
              if (readout) {
                swapText(readout, key === 'all'
                  ? `PRESENT TYPES: <strong>${buttons.length - 1}</strong>`
                  : `ACTIVE: <strong>${key.toUpperCase()}</strong> [${String(typeCounts[key] || 0).padStart(2, '0')}]`, true);
              }

              // Update Subcategory Movement Tiles if present (FLIP reorder)
              if (subWrap && subCategories.length > 0) {
                flipTiles(subWrap.querySelector('.category-tiles-grid') ?? subWrap, () => {
                  subCategories.forEach(sub => {
                    const tile = subWrap.querySelector(`[data-sub-id="${sub.id}"]`);
                    if (!tile) return;
                    const subAll = artworks.filter(w => w.movement_id === sub.id);
                    const subFiltered = key === 'all' ? subAll : subAll.filter(w => (w.type || 'Painting') === key);
                    const count = subFiltered.length;
                    tile.href = key === 'all' ? `#/category/${sub.id}` : `#/category/${sub.id}?type=${encodeURIComponent(key)}`;
                    tile.classList.toggle('is-filtered-out', count === 0);
                    tile.style.order = (key !== 'all')
                      ? (count > 0 ? String(sub.start_year) : '1000000')
                      : '';

                    const pill = tile.querySelector('.cat-tile-active-pill');
                    if (pill) {
                      setTileActivePill(tile, key !== 'all' && count > 0 ? key : '');
                    }

                    swapText(
                      tile.querySelector('.cat-tile-count'),
                      `[ ${count} ${count === 1 ? 'WORK' : 'WORKS'} ${key === 'all' ? 'CATALOGUED' : 'MATCHING'} ]`
                    );
                  });
                });
              }

              // Seamlessly update artwork grid
              update();

              // 2% chance: fleeting ghost paw appears and flies away
              if (Math.random() < 0.02 || (e && e.altKey)) {
                spawnGhostPaw(e.clientX || (window.innerWidth / 2), e.clientY || (window.innerHeight / 2));
              }

              // 1% chance: Persona 5 text appears
              if (Math.random() < 0.01 || (e && e.shiftKey)) {
                spawnPersona5ShibuyaVocalisation(btn);
              }
            });
          });
        }

        if (searchInput) {
          searchInput.addEventListener('input', e => {
            searchQuery = e.target.value.trim();
            if (sheetSearch) sheetSearch.value = searchQuery;
            update();
          });
        }
        if (sheetSearch) {
          sheetSearch.addEventListener('input', e => {
            searchQuery = e.target.value.trim();
            if (searchInput) searchInput.value = searchQuery;
            update();
          });
        }
        if (sortSelect) {
          sortSelect.addEventListener('change', e => {
            sortOption = e.target.value;
            if (sheetSort) sheetSort.value = sortOption;
            update();
          });
        }
        if (sheetSort) {
          sheetSort.addEventListener('change', e => {
            sortOption = e.target.value;
            if (sortSelect) sortSelect.value = sortOption;
            update();
          });
        }
        if (openSheetBtn) {
          openSheetBtn.addEventListener('click', () => {
            sheet.classList.add('active');
            document.body.style.overflow = 'hidden';
          });
        }

        function closeSheet() {
          sheet.classList.remove('active');
          document.body.style.overflow = '';
        }

        if (closeSheetBtn) closeSheetBtn.addEventListener('click', closeSheet);
        if (applySheetBtn) applySheetBtn.addEventListener('click', closeSheet);
        if (sheet) {
          sheet.addEventListener('click', e => {
            if (e.target === sheet) closeSheet();
          });
        }

        if (searchQuery) {
          if (searchInput) searchInput.value = searchQuery;
          if (sheetSearch) sheetSearch.value = searchQuery;
          update();
        }
      }

      // 7. VIEW: ARTWORK DOSSIER (#/work/<slug>)
      function renderArtworkDetailView(slug) {
        const work = artworkSlugMap.get(slug);
        if (!work) {
          appRoot.innerHTML = `<div style="padding: 64px 32px; text-align: center;"><h2>Artwork not found</h2><p><a href="#/timeline">Return to Timeline</a></p></div>`;
          return;
        }

        const era = categoryMap.get(work.era_id);
        const mov = categoryMap.get(work.movement_id);
        if (work.era_id) setActiveEra(work.era_id);

        const navCatId = (work.movement_id && work.movement_id !== work.era_id) ? work.movement_id : work.era_id;
        const categoryWorks = artworks.filter(w => {
          if (navCatId.startsWith('mov-')) {
            return w.movement_id === navCatId;
          } else {
            return w.era_id === navCatId;
          }
        });
        categoryWorks.sort((a, b) => (a.year_sort || a.year || 0) - (b.year_sort || b.year || 0));
        const currentCatIndex = categoryWorks.findIndex(w => w.id === work.id);
        const prevWork = currentCatIndex > 0 ? categoryWorks[currentCatIndex - 1] : categoryWorks[categoryWorks.length - 1];
        const nextWork = currentCatIndex < categoryWorks.length - 1 ? categoryWorks[currentCatIndex + 1] : categoryWorks[0];
        const overallIndex = artworks.findIndex(w => w.id === work.id);

        const allAngles = getArtworkImages(work);
        let currentSlideIdx = 0;

        let html = `
          <div class="artwork-page-view" id="artwork-page-container">
            <div class="artwork-top-nav">
              <div class="artwork-nav-crumbs">
                <a href="#/categories">COLLECTION</a>
                ${era ? ` › <a href="#/category/${era.id}">${era.name.toUpperCase()}</a>` : ''}
                ${mov ? ` › <a href="#/category/${mov.id}">${mov.name.toUpperCase()}</a>` : ''}
              </div>
              <div class="artwork-nav-stepper">
                <a href="#/work/${prevWork.id}" class="nav-step-btn" title="Previous artwork in category">‹ PREV</a>
                <span>[ ${currentCatIndex + 1} / ${categoryWorks.length} ]</span>
                <a href="#/work/${nextWork.id}" class="nav-step-btn" title="Next artwork in category">NEXT ›</a>
              </div>
            </div>

            <div class="artwork-layout">
              <div class="artwork-dossier">
                <div class="dossier-inv-header">
                  <span class="inv-stamp">${work.inv_number} · ARCHIVE [${overallIndex + 1} / ${artworks.length}]</span>
                  <span class="fabric-tag">${work.date_display}</span>
                </div>

                <div class="frl-label-caption" style="margin-top: 14px;">Title</div>
                <h1 class="artwork-primary-title" style="margin-top: 2px;">${work.title_eng || work.title}</h1>
                ${work.title_eng && work.title_eng !== work.title ? `<div class="artwork-orig-title">${work.title}</div>` : ''}

                <div class="frl-label-caption" style="margin-top: 18px;">Author</div>
                <div class="artwork-artist-heading" style="margin-top: 2px;">${work.artist} (${work.artist_dates || work.culture})</div>

                <div style="margin: 22px 0 24px 0;">
                  <button class="add-to-stack-btn ${CuratorialStack.has(work.id) ? 'active' : ''}" id="artwork-stack-btn" onclick="window.toggleWorkStack('${work.id}', this);">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="${CuratorialStack.has(work.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                    <span>${CuratorialStack.has(work.id) ? '✓ IN YOUR STACK [CLICK TO REMOVE]' : '+ ADD TO STACK'}</span>
                  </button>
                </div>

                ${work.text_policy === 'attribution-only' ? `
                <div class="frl-label-caption">Shown with credit to the artist</div>
                <div class="dossier-desc-text dossier-attribution" style="margin-top: 6px;">${work.attribution || `${work.title}, ${work.date_display}, by ${work.artist}`}</div>
                <p class="rights-note">© ${work.artist}. All rights reserved. Images load directly from the artist’s own website and are not copied here. See more at <a href="${escapeAttr(work.source_url)}" target="_blank" rel="noopener noreferrer">${(work.source_url || '').replace(/^https?:\/\/(www\.)?/, '')}</a>.</p>
                ` : `
                <div class="frl-label-caption">From the Collection</div>
                <div class="dossier-desc-text" style="margin-top: 6px;">${work.description}</div>

                ${work.context ? `<div class="historical-margin-note" style="margin-top: 18px;">
                  <p>${work.context}</p>
                </div>` : ''}
                `}

                <div class="frl-specs-table">
                  <div class="frl-spec-item">
                    <span class="frl-spec-label">Classification / Type</span>
                    <span class="frl-spec-value fabric-tag">${work.type || 'Painting'}</span>
                  </div>
                  <div class="frl-spec-item">
                    <span class="frl-spec-label">Location / Collection</span>
                    <span class="frl-spec-value fabric-tag">${work.collection}</span>
                  </div>
                  <div class="frl-spec-item">
                    <span class="frl-spec-label">Year / Era</span>
                    <span class="frl-spec-value tabular-numbers">${work.date_display}</span>
                  </div>
                  <div class="frl-spec-item">
                    <span class="frl-spec-label">Medium</span>
                    <span class="frl-spec-value">${work.medium}</span>
                  </div>
                  <div class="frl-spec-item">
                    <span class="frl-spec-label">Culture</span>
                    <span class="frl-spec-value">${work.culture}</span>
                  </div>
                  <div class="frl-spec-item">
                    <span class="frl-spec-label">Dimensions</span>
                    <span class="frl-spec-value tabular-numbers">${work.dimensions || 'Archival folio standards'}</span>
                  </div>
                  <div class="frl-spec-item">
                    <span class="frl-spec-label">Image Licence</span>
                    <span class="frl-spec-value">${work.license_url ? `<a href="${escapeAttr(work.license_url)}" target="_blank" rel="noopener noreferrer license">${work.license}</a>` : (work.license || 'Unverified')}</span>
                  </div>
                  ${work.image_credit ? `<div class="frl-spec-item">
                    <span class="frl-spec-label">Image Credit</span>
                    <span class="frl-spec-value">${work.image_credit}</span>
                  </div>` : ''}
                </div>

                <div class="frl-label-caption">Archival Keywords</div>
                <div class="tag-cloud-row" style="margin-top: 6px;">
                  ${(work.tags || []).map(t => `<span class="typewriter-tag-chip">#${t}</span>`).join('')}
                </div>

                <hr class="basting-rule" style="margin: 28px 0;">

                <div class="archive-actions-row">
                  <a href="${work.source_url}" target="_blank" rel="noopener noreferrer" class="primary-archive-btn">
                    ${work.text_policy === 'attribution-only' ? 'ARTIST’S WEBSITE ↗' : 'MUSEUM COLLECTION ARCHIVE ↗'}
                  </a>
                </div>
              </div>

              <div class="artwork-media-column">
                <div class="spread-carousel" id="carousel">
                  <div class="carousel-viewport">
                    <div class="carousel-stage ${allAngles.length > 1 ? 'has-multiple' : ''}" id="carousel-stage">
                      ${allAngles.map((imgUrl, idx) => `
                        <img src="${escapeAttr(displayUrl(work, imgUrl, 1400))}" data-raw-src="${escapeAttr(imgUrl)}" alt="${escapeAttr(work.title_eng || work.title)} - View ${idx + 1}"
                             class="slide ${idx === 0 ? 'is-active' : ''}"
                             data-slide-index="${idx}"
                             ${idx === 0 ? 'fetchpriority="high" decoding="sync"' : 'decoding="async"'}
                             onerror="window.handleImageError(this, ${jsArg(work.inv_number)}, ${jsArg(work.title)}, ${jsArg(work.artist)}, ${jsArg(work.source_url)})">
                      `).join('')}
                    </div>
                  </div>

                  ${allAngles.length > 1 ? `
                    <button class="nav prev" id="carousel-nav-prev" aria-label="Previous angle view"></button>
                    <button class="nav next" id="carousel-nav-next" aria-label="Next angle view"></button>
                    <div class="carousel-counter" id="carousel-counter">[ 1 / ${allAngles.length} ]</div>
                    <div class="carousel-thumbs-row">
                      ${allAngles.map((imgUrl, idx) => `
                        <button class="carousel-thumb-btn ${idx === 0 ? 'is-active' : ''}" data-thumb-index="${idx}" type="button" title="View angle ${idx + 1}">
                          <img src="${localUrl(work, imgUrl, 140) || getOptimizedImageUrl(imgUrl, 140)}" data-raw-src="${imgUrl}" alt="Angle ${idx + 1}" loading="lazy" decoding="async">
                        </button>
                      `).join('')}
                    </div>
                  ` : ''}

                  <div class="hover-loupe" id="hover-loupe" aria-hidden="true">
                    <div class="loupe-tick loupe-tick-n"></div>
                    <div class="loupe-tick loupe-tick-s"></div>
                    <div class="loupe-tick loupe-tick-w"></div>
                    <div class="loupe-tick loupe-tick-e"></div>
                    <div class="loupe-badge" id="loupe-zoom-badge">×2.5</div>
                  </div>
                </div>

                <div class="image-controls-toolbar">
                  <div class="loupe-buttons-row">
                    <span style="font-weight: 700;">LOUPE:</span>
                    <button class="loupe-ctrl-btn" id="loupe-toggle-btn" title="Toggle magnifying loupe">OFF</button>
                    <button class="loupe-ctrl-btn" data-zoom="2" id="btn-zoom-2">×2</button>
                    <button class="loupe-ctrl-btn active" data-zoom="2.5" id="btn-zoom-25">×2.5</button>
                    <button class="loupe-ctrl-btn" data-zoom="3" id="btn-zoom-3">×3</button>
                    <button class="loupe-ctrl-btn" data-zoom="4" id="btn-zoom-4">×4</button>
                  </div>
                  <div>
                    <button class="loupe-ctrl-btn" id="open-fullscreen-btn">FULL SCREEN [TAP/CLICK]</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;

        appRoot.innerHTML = html;

        setupHoverLoupe(work, allAngles[0]);

        const carouselStage = document.getElementById('carousel-stage');
        const slides = Array.from(carouselStage ? carouselStage.querySelectorAll('.slide') : []);
        const counter = document.getElementById('carousel-counter');
        let isSlideTransitioning = false;

        function updateLayerClasses(index) {
          slides.forEach(s => s.classList.remove('is-prev', 'is-active', 'is-next'));
          if (slides.length <= 1) {
            if (slides[0]) slides[0].classList.add('is-active');
            return;
          }
          if (slides.length === 2) {
            const other = (index + 1) % 2;
            slides[index].classList.add('is-active');
            slides[other].classList.add(index === 0 ? 'is-next' : 'is-prev');
          } else {
            const prev = (index - 1 + slides.length) % slides.length;
            const next = (index + 1) % slides.length;
            slides[prev].classList.add('is-prev');
            slides[index].classList.add('is-active');
            slides[next].classList.add('is-next');
          }
          if (counter) counter.textContent = `[ ${index + 1} / ${slides.length} ]`;
          document.querySelectorAll('.carousel-thumb-btn').forEach((btn, idx) => {
            btn.classList.toggle('is-active', idx === index);
          });
        }

        async function warmUpSlide(index) {
          const target = (index + slides.length) % slides.length;
          const img = slides[target];
          if (!img) return;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            delete img.dataset.src;
          }
          if (img.decode) {
            try {
              await img.decode();
            } catch (e) {}
          }
        }

        window.goToSlide = goToSlide;
        document.querySelectorAll('.carousel-thumb-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.thumbIndex);
            if (!isNaN(idx)) goToSlide(idx);
          });
        });

        async function goToSlide(newIndex) {
          if (isSlideTransitioning || slides.length <= 1) return;
          isSlideTransitioning = true;
          const targetIndex = (newIndex + slides.length) % slides.length;
          await warmUpSlide(targetIndex);

          requestAnimationFrame(() => {
            currentSlideIdx = targetIndex;
            updateLayerClasses(currentSlideIdx);
            isSlideTransitioning = false;

            if (window.updateLoupeTarget) {
              window.updateLoupeTarget(slides[currentSlideIdx], allAngles[currentSlideIdx]);
            }

            warmUpSlide(currentSlideIdx + 1);
            warmUpSlide(currentSlideIdx - 1);
          });
        }

        const prevNav = document.getElementById('carousel-nav-prev');
        const nextNav = document.getElementById('carousel-nav-next');
        if (prevNav) prevNav.addEventListener('click', (e) => { e.stopPropagation(); goToSlide(currentSlideIdx - 1); });
        if (nextNav) nextNav.addEventListener('click', (e) => { e.stopPropagation(); goToSlide(currentSlideIdx + 1); });

        if (slides.length > 1) {
          updateLayerClasses(0);
          warmUpSlide(1);
          warmUpSlide(slides.length - 1);
        }

        const carouselWrap = document.getElementById('carousel');
        const fsBtn = document.getElementById('open-fullscreen-btn');
        const openFs = () => openFullscreenViewer(work, currentSlideIdx, (newIdx) => {
          if (newIdx !== currentSlideIdx && slides.length > 1) {
            goToSlide(newIdx);
          }
        });

        slides.forEach((slide) => {
          slide.addEventListener('click', (e) => {
            if (slide.classList.contains('is-prev')) {
              e.stopPropagation();
              goToSlide(currentSlideIdx - 1);
            } else if (slide.classList.contains('is-next')) {
              e.stopPropagation();
              goToSlide(currentSlideIdx + 1);
            }
          });
        });

        if (carouselWrap) {
          carouselWrap.addEventListener('click', (e) => {
            if (!e.target.closest('.nav') && !e.target.closest('.slide.is-prev') && !e.target.closest('.slide.is-next')) {
              openFs();
            }
          });
        }
        if (fsBtn) fsBtn.addEventListener('click', openFs);

        let touchStartX = 0;
        if (carouselWrap) {
          carouselWrap.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
          }, { passive: true });
          carouselWrap.addEventListener('touchend', (e) => {
            const deltaX = e.changedTouches[0].screenX - touchStartX;
            if (Math.abs(deltaX) > 40 && slides.length > 1) {
              deltaX < 0 ? goToSlide(currentSlideIdx + 1) : goToSlide(currentSlideIdx - 1);
            }
          }, { passive: true });
        }

        window.currentArtworkKeyHandler = function(e) {
          if (document.querySelector('.pswp--open') || (lightboxModal && lightboxModal.classList.contains('active'))) {
            return;
          }
          if (e.key === 'ArrowLeft') {
            if (slides.length > 1) {
              goToSlide(currentSlideIdx - 1);
            } else {
              window.location.hash = `#/work/${prevWork.id}`;
            }
          } else if (e.key === 'ArrowRight') {
            if (slides.length > 1) {
              goToSlide(currentSlideIdx + 1);
            } else {
              window.location.hash = `#/work/${nextWork.id}`;
            }
          } else if ((e.key === '+' || e.key === '=') && activeLoupeInstance) {
            activeLoupeInstance.stepZoom(1);
          } else if ((e.key === '-' || e.key === '_') && activeLoupeInstance) {
            activeLoupeInstance.stepZoom(-1);
          }
        };
        window.addEventListener('keydown', window.currentArtworkKeyHandler);
      }

      function setupHoverLoupe(work, initialRawUrl) {
        if (activeLoupeInstance) {
          activeLoupeInstance.destroy();
          activeLoupeInstance = null;
        }
        if (window.innerWidth <= 768 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) {
          return;
        }
        const wrap = document.getElementById('carousel') || document.getElementById('artwork-hero-wrap');
        const loupe = document.getElementById('hover-loupe');
        const zoomBadge = document.getElementById('loupe-zoom-badge');
        const toggleBtn = document.getElementById('loupe-toggle-btn');
        const zoomButtons = document.querySelectorAll('[data-zoom]');

        if (!wrap || !loupe) return;

        let activeImg = wrap.querySelector('.slide.is-active') || wrap.querySelector('.slide') || document.getElementById('main-artwork-img');

        let isEnabled = false;
        let zoom = 2.5;
        const zoomLevels = [2, 2.5, 3, 4];
        let metrics = null;
        let rAF = null;
        let pendingEvent = null;
        let destroyed = false;

        function getRenderedImageMetrics(imgEl, wrapEl) {
          if (!imgEl || !wrapEl) return null;
          const rawImgRect = imgEl.getBoundingClientRect();
          const wrapRect = wrapEl.getBoundingClientRect();
          if (!rawImgRect.width || !rawImgRect.height) return null;

          const natW = imgEl.naturalWidth || rawImgRect.width;
          const natH = imgEl.naturalHeight || rawImgRect.height;
          const natRatio = natW / natH;
          const boxRatio = rawImgRect.width / rawImgRect.height;

          let renderW = rawImgRect.width;
          let renderH = rawImgRect.height;
          let renderLeft = rawImgRect.left;
          let renderTop = rawImgRect.top;

          if (natRatio > boxRatio) {
            renderW = rawImgRect.width;
            renderH = rawImgRect.width / natRatio;
            renderTop = rawImgRect.top + (rawImgRect.height - renderH) / 2;
          } else {
            renderH = rawImgRect.height;
            renderW = rawImgRect.height * natRatio;
            renderLeft = rawImgRect.left + (rawImgRect.width - renderW) / 2;
          }

          return {
            left: renderLeft, top: renderTop, width: renderW, height: renderH,
            natW, natH, wrapLeft: wrapRect.left, wrapTop: wrapRect.top
          };
        }

        // Raw URL for a slide (template sets data-raw-src) and what it's already displaying.
        function rawUrlFor(img, fallback) {
          return (img && img.dataset && img.dataset.rawSrc) || fallback || work.large_url || work.image_url;
        }
        function displayedSrcFor(img, raw) {
          return (img && (img.currentSrc || img.src)) || getOptimizedImageUrl(raw, SLIDE_WIDTH);
        }

        const res = createLoupeResolutionManager(loupe, {
          getRenderedWidth: () => {
            const m = getRenderedImageMetrics(activeImg, wrap);
            return m ? m.width : 0;
          },
          onNativeWidthKnown: () => updateBounds()
        });
        res.setZoom(zoom);

        const initialRaw = rawUrlFor(activeImg, initialRawUrl);
        res.setSource(initialRaw, displayedSrcFor(activeImg, initialRaw));

        function updateBounds() {
          if (!activeImg) {
            activeImg = wrap.querySelector('.slide.is-active') || wrap.querySelector('.slide');
          }
          if (!activeImg) return;
          metrics = getRenderedImageMetrics(activeImg, wrap);
          if (!metrics) return;

          // Dim only when the master's true width is known and too small for that zoom.
          const nativeW = res.getKnownNativeWidth();
          const maxAllowedZoom = nativeW ? Math.max(2, nativeW / (metrics.width || 600)) : Infinity;

          zoomButtons.forEach(btn => {
            const val = parseFloat(btn.dataset.zoom);
            if (val > maxAllowedZoom * 1.25) {
              btn.style.opacity = '0.4';
              btn.title = 'Zoom exceeds native resolution';
            } else {
              btn.style.opacity = '1';
              btn.title = `Zoom ×${val}`;
            }
          });

          res.reevaluate(); // layout or DPR may have changed the needed tier
        }

        if (activeImg) {
          activeImg.addEventListener('load', updateBounds);
        }

        function updateLoupeTarget(newImg, newRawUrl) {
          if (activeImg) activeImg.removeEventListener('load', updateBounds);
          activeImg = newImg;
          if (activeImg) activeImg.addEventListener('load', updateBounds);
          const raw = rawUrlFor(activeImg, newRawUrl);
          res.setSource(raw, displayedSrcFor(activeImg, raw)); // aborts the previous angle's download
          updateBounds();
          if (pendingEvent) renderLoupe(pendingEvent);
        }
        window.updateLoupeTarget = updateLoupeTarget;

        function setZoom(newZoom) {
          zoom = newZoom;
          if (zoomBadge) zoomBadge.textContent = `×${zoom}`;
          zoomButtons.forEach(b => {
            b.classList.toggle('active', parseFloat(b.dataset.zoom) === zoom);
          });
          res.setZoom(zoom); // debounced tier upgrade (buttons and +/- keys both land here)
          if (pendingEvent) renderLoupe(pendingEvent);
        }

        function stepZoom(direction) {
          let currentIdx = zoomLevels.indexOf(zoom);
          if (currentIdx === -1) currentIdx = 1;
          const nextIdx = Math.max(0, Math.min(zoomLevels.length - 1, currentIdx + direction));
          setZoom(zoomLevels[nextIdx]);
        }

        function renderLoupe(e) {
          if (!isDesktopPointer || !isEnabled) return;
          metrics = getRenderedImageMetrics(activeImg, wrap);
          if (!metrics) return;

          const cursorX = e.clientX - metrics.left;
          const cursorY = e.clientY - metrics.top;

          if (cursorX < -8 || cursorX > metrics.width + 8 || cursorY < -8 || cursorY > metrics.height + 8) {
            loupe.classList.remove('is-visible');
            wrap.classList.remove('loupe-enabled');
            return;
          }

          loupe.classList.add('is-visible');
          wrap.classList.add('loupe-enabled');

          const loupeW = loupe.offsetWidth || 200;
          const loupeH = loupe.offsetHeight || 200;
          const loupeRadiusX = loupeW / 2;
          const loupeRadiusY = loupeH / 2;

          const lensX = (e.clientX - metrics.wrapLeft) - loupeRadiusX;
          const lensY = (e.clientY - metrics.wrapTop) - loupeRadiusY;
          loupe.style.transform = `translate3d(${lensX.toFixed(1)}px, ${lensY.toFixed(1)}px, 0)`;

          // Sized from the RENDERED bitmap, so swapping in a larger source keeps alignment
          const zoomedW = metrics.width * zoom;
          const zoomedH = metrics.height * zoom;
          const bgPosX = loupeRadiusX - (cursorX * zoom);
          const bgPosY = loupeRadiusY - (cursorY * zoom);

          loupe.style.backgroundSize = `${zoomedW.toFixed(1)}px ${zoomedH.toFixed(1)}px`;
          loupe.style.backgroundPosition = `${bgPosX.toFixed(1)}px ${bgPosY.toFixed(1)}px`;
        }

        function onMouseMove(e) {
          pendingEvent = e;
          if (!rAF) {
            rAF = requestAnimationFrame(() => {
              if (pendingEvent) renderLoupe(pendingEvent);
              rAF = null;
            });
          }
        }

        function onMouseEnter(e) {
          updateBounds();
          onMouseMove(e);
        }

        function onMouseLeave() {
          // Deliberately NOT cancelling downloads here: brushing off the edge
          // shouldn't throw away a half-loaded master.
          loupe.classList.remove('is-visible');
          wrap.classList.remove('loupe-enabled');
          pendingEvent = null;
        }

        wrap.addEventListener('mousemove', onMouseMove, { passive: true });
        wrap.addEventListener('mouseenter', onMouseEnter, { passive: true });
        wrap.addEventListener('mouseleave', onMouseLeave, { passive: true });

        zoomButtons.forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            setZoom(parseFloat(btn.dataset.zoom));
          });
        });

        if (toggleBtn) {
          toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isEnabled = !isEnabled;
            toggleBtn.textContent = isEnabled ? 'ON' : 'OFF';
            toggleBtn.classList.toggle('active', isEnabled);
            if (isEnabled) {
              res.activate(); // starts fetching the right tier before the first hover
            } else {
              res.deactivate();
              loupe.classList.remove('is-visible');
              wrap.classList.remove('loupe-enabled');
            }
          });
        }

        window.addEventListener('resize', updateBounds, { passive: true });
        window.addEventListener('scroll', updateBounds, { passive: true });

        activeLoupeInstance = {
          destroy() {
            if (destroyed) return;
            destroyed = true;
            if (rAF) cancelAnimationFrame(rAF);
            if (activeImg) activeImg.removeEventListener('load', updateBounds);
            window.removeEventListener('resize', updateBounds);
            window.removeEventListener('scroll', updateBounds);
            wrap.removeEventListener('mousemove', onMouseMove);
            wrap.removeEventListener('mouseenter', onMouseEnter);
            wrap.removeEventListener('mouseleave', onMouseLeave);
            res.destroy(); // aborts in-flight loads, revokes blob URLs
            if (window.updateLoupeTarget === updateLoupeTarget) window.updateLoupeTarget = null;
          },
          setZoom,
          stepZoom,
          updateBounds
        };
      }

      // Single-Work Multi-Angle PhotoSwipe Viewer with Floating Archival HUD
      function openFullscreenViewer(initialWork, initialSlideIdx = 0, onSlideChange = null) {
        if (typeof PhotoSwipe !== 'undefined') {
          try {
            const activeMainImg = document.querySelector('.spread-carousel .slide.is-active') || document.querySelector('.spread-carousel .slide');
            const defaultW = (activeMainImg && activeMainImg.naturalWidth) || 1600;
            const defaultH = (activeMainImg && activeMainImg.naturalHeight) || 1200;

            const angleUrls = getArtworkImages(initialWork);

            const items = angleUrls.map((rawUrl, idx) => {
              const slideEl = document.querySelector(`.spread-carousel .slide[data-slide-index="${idx}"]`);
              const masterUrl = getHighResUrl(rawUrl);
              const v = localVariant(initialWork, rawUrl);

              let itemW = (v && v.w) || (slideEl && slideEl.naturalWidth) || defaultW;
              let itemH = (v && v.h) || (slideEl && slideEl.naturalHeight) || defaultH;
              const aspect = (itemW && itemH)
                ? (itemW / itemH)
                : ((slideEl && slideEl.naturalWidth && slideEl.naturalHeight)
                    ? (slideEl.naturalWidth / slideEl.naturalHeight)
                    : (initialWork.aspect_ratio || 1.33));

              if (itemW && !itemH) itemH = Math.round(itemW / aspect);
              if (itemH && !itemW) itemW = Math.round(itemH * aspect);

              return {
                src: getOptimizedImageUrl(masterUrl, 2560, 85),
                msrc: (slideEl && (slideEl.currentSrc || slideEl.src)) || getOptimizedImageUrl(rawUrl, 500),
                rawUrl: rawUrl,
                width: itemW,
                height: itemH,
                aspect: aspect,
                alt: `${initialWork.title_eng || initialWork.title} - View ${idx + 1}`,
                caption: `${initialWork.inv_number} — ${initialWork.title_eng || initialWork.title} (${initialWork.artist})`
              };
            });

            const pswp = new PhotoSwipe({
              dataSource: items,
              index: (initialSlideIdx >= 0 && initialSlideIdx < items.length) ? initialSlideIdx : 0,
              bgOpacity: 0.97,
              showHideAnimationType: 'fade',
              wheelToZoom: true,
              initialZoomLevel: 'fit',

              secondaryZoomLevel: (zl) => {
                const ratio = (zl.itemData && zl.itemData.aspect) || 1;
                if (ratio > 2.2) return Math.min(zl.fill || zl.vFill || 1, 1);
                const s = (zl.fit || 0.5) * 2.5;
                return s <= 1 ? s : Math.max(1, (zl.fit || 0.5) * 1.5);
              },

              maxZoomLevel: (zl) => {
                const ratio = (zl.itemData && zl.itemData.aspect) || 1;
                const base = ratio > 2.2 ? (zl.fill || zl.vFill || 1) : (zl.fit || 0.5);
                return Math.max(1, base * 4);
              },

              arrowPrevTitle: 'Previous Angle [Left Arrow]',
              arrowNextTitle: 'Next Angle [Right Arrow]',
              closeTitle: 'Close [Esc]',
              zoomTitle: 'Zoom in/out [Click / Mouse Wheel]'
            });

            // Resilient image candidate loader: completely eliminates "The image could not be loaded"
            pswp.on('contentLoadImage', (e) => {
              const content = e.content;
              if (!content.isImageContent()) return;
              e.preventDefault();

              const img = content.element;
              const data = content.data || {};
              img.alt = data.alt || '';

              const candidates = [];
              if (data.src) candidates.push(data.src);
              if (data.rawUrl && data.rawUrl !== data.src) candidates.push(data.rawUrl);

              // Standard Wikimedia Commons allowed thumbnail bucket fallback
              const anyUrl = data.src || data.rawUrl || '';
              if (anyUrl.includes('upload.wikimedia.org/wikipedia/commons/')) {
                const parts = anyUrl.split('/commons/')[1]?.split('/');
                if (parts && parts.length >= 3) {
                  const filename = parts[2];
                  candidates.push(`https://upload.wikimedia.org/wikipedia/commons/thumb/${parts[0]}/${parts[1]}/${filename}/1920px-${filename}`);
                  candidates.push(`https://upload.wikimedia.org/wikipedia/commons/thumb/${parts[0]}/${parts[1]}/${filename}/1280px-${filename}`);
                }
              }

              if (data.msrc && !candidates.includes(data.msrc)) candidates.push(data.msrc);

              let currentIdx = 0;
              let isHandled = false;

              function tryCandidate() {
                if (currentIdx >= candidates.length) {
                  if (!isHandled) {
                    isHandled = true;
                    content.onError();
                  }
                  return;
                }
                const candidateSrc = candidates[currentIdx++];
                const tempImg = new Image();
                tempImg.decoding = 'async';

                function onSuccess() {
                  if (isHandled) return;
                  isHandled = true;
                  img.src = candidateSrc;
                  if (tempImg.naturalWidth && tempImg.naturalHeight) {
                    content.data.width = tempImg.naturalWidth;
                    content.data.height = tempImg.naturalHeight;
                    if (content.slide) {
                      content.slide.width = tempImg.naturalWidth;
                      content.slide.height = tempImg.naturalHeight;
                      content.slide.calculateSize();
                      // Re-apply fit zoom so that recalculating dimensions does not leave an accidental zoom offset
                      if (content.slide.zoomLevels && typeof content.slide.zoomLevels.fit === 'number') {
                        content.slide.zoomTo(content.slide.zoomLevels.fit, { x: 0, y: 0 }, 0);
                      }
                    }
                  }
                  content.onLoaded();
                  if (content.slide) {
                    content.slide.updateContentSize(true);
                  }
                }

                if (tempImg.complete && tempImg.naturalWidth > 0) {
                  onSuccess();
                } else {
                  tempImg.onload = onSuccess;
                  tempImg.onerror = () => tryCandidate();
                  tempImg.src = candidateSrc;
                }
              }

              content.state = 'loading';
              tryCandidate();
            });

            pswp.on('uiRegister', () => {
              pswp.ui.registerElement({
                name: 'custom-zoom-bar',
                order: 8,
                isButton: false,
                appendTo: 'wrapper',
                html: `
                  <div class="pswp-zoom-controls">
                    <button class="pswp-zoom-btn" id="pswp-btn-out" title="Zoom Out (−)">−</button>
                    <span class="pswp-zoom-readout" id="pswp-zoom-readout">FIT</span>
                    <button class="pswp-zoom-btn" id="pswp-btn-in" title="Zoom In (+)">+</button>
                    <button class="pswp-zoom-btn active" id="pswp-btn-fit" title="Fit to Screen">FIT</button>
                    <button class="pswp-zoom-btn" id="pswp-btn-fill" title="Fill Screen Height">FILL HEIGHT</button>
                    <button class="pswp-zoom-btn" id="pswp-btn-100" title="100% Native Resolution">100%</button>
                  </div>
                `,
                onInit: (el, pswpInstance) => {
                  const btnOut = el.querySelector('#pswp-btn-out');
                  const btnIn = el.querySelector('#pswp-btn-in');
                  const btnFit = el.querySelector('#pswp-btn-fit');
                  const btnFill = el.querySelector('#pswp-btn-fill');
                  const btn100 = el.querySelector('#pswp-btn-100');
                  const readout = el.querySelector('#pswp-zoom-readout');

                  function syncZoomUI() {
                    if (!pswpInstance.currSlide || !pswpInstance.currSlide.zoomLevels) return;
                    const curr = pswpInstance.currSlide.currZoomLevel;
                    const zl = pswpInstance.currSlide.zoomLevels;
                    const pct = Math.round((curr / (zl.fit || 1)) * 100);
                    if (readout) readout.textContent = `${pct}%`;
                    if (btnFit) btnFit.classList.toggle('active', Math.abs(curr - zl.fit) < 0.02);
                    if (btnFill) btnFill.classList.toggle('active', Math.abs(curr - zl.fill) < 0.02);
                    if (btn100) btn100.classList.toggle('active', Math.abs(curr - 1.0) < 0.02);
                  }

                  pswpInstance.on('zoomPanUpdate', syncZoomUI);
                  pswpInstance.on('afterInit', syncZoomUI);
                  pswpInstance.on('change', syncZoomUI);

                  if (btnOut) btnOut.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!pswpInstance.currSlide) return;
                    const curr = pswpInstance.currSlide.currZoomLevel;
                    const fitVal = (pswpInstance.currSlide.zoomLevels && pswpInstance.currSlide.zoomLevels.fit) || 0.2;
                    pswpInstance.zoomTo(Math.max(curr / 1.4, fitVal), { x: window.innerWidth / 2, y: window.innerHeight / 2 }, 220);
                  });
                  if (btnIn) btnIn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!pswpInstance.currSlide) return;
                    const curr = pswpInstance.currSlide.currZoomLevel;
                    pswpInstance.zoomTo(curr * 1.4, { x: window.innerWidth / 2, y: window.innerHeight / 2 }, 220);
                  });
                  if (btnFit) btnFit.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!pswpInstance.currSlide || !pswpInstance.currSlide.zoomLevels) return;
                    pswpInstance.zoomTo(pswpInstance.currSlide.zoomLevels.fit, { x: window.innerWidth / 2, y: window.innerHeight / 2 }, 260);
                  });
                  if (btnFill) btnFill.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!pswpInstance.currSlide || !pswpInstance.currSlide.zoomLevels) return;
                    pswpInstance.zoomTo(pswpInstance.currSlide.zoomLevels.fill, { x: window.innerWidth / 2, y: window.innerHeight / 2 }, 260);
                  });
                  if (btn100) btn100.addEventListener('click', (e) => {
                    e.stopPropagation();
                    pswpInstance.zoomTo(1.0, { x: window.innerWidth / 2, y: window.innerHeight / 2 }, 260);
                  });
                }
              });
            });

            pswp.on('change', () => {
              if (onSlideChange) {
                onSlideChange(pswp.currIndex);
              }
            });

            window.activePhotoSwipe = pswp;
            pswp.on('destroy', () => {
              if (window.activePhotoSwipe === pswp) window.activePhotoSwipe = null;
            });

            pswp.init();
            return;
          } catch (pswpErr) {
            console.error('PhotoSwipe initialization failed, falling back to native lightbox:', pswpErr);
          }
        }

        openNativeLightbox(initialWork.large_url || initialWork.image_url, `${initialWork.inv_number} — ${initialWork.title_eng || initialWork.title} (${initialWork.artist})`);
      }

      // Fallback Lightbox Logic
      const lightboxModal = document.getElementById('lightbox-modal');
      const lightboxImg = document.getElementById('lightbox-img');
      const lightboxMeta = document.getElementById('lightbox-meta');
      const lightboxCloseBtn = document.getElementById('lightbox-close-btn');
      const lightboxZoomToggle = document.getElementById('lightbox-zoom-toggle');
      const lbViewport = document.getElementById('lightbox-viewport');
      let isZoomed = false;
      let lbScale = 1;
      let lbPanX = 0;
      let lbPanY = 0;
      let isLbDragging = false;
      let lbStartX = 0;
      let lbStartY = 0;

      function updateLbTransform() {
        if (lightboxImg) {
          lightboxImg.style.transform = `translate(${lbPanX}px, ${lbPanY}px) scale(${lbScale})`;
        }
      }

      function openNativeLightbox(imgUrl, metaText) {
        lightboxImg.src = getHighResUrl(imgUrl);
        lightboxMeta.textContent = metaText;
        lightboxModal.classList.add('active');
        isZoomed = false;
        lbScale = 1;
        lbPanX = 0;
        lbPanY = 0;
        updateLbTransform();
        lightboxZoomToggle.textContent = 'ZOOM: 100%';
        document.body.style.overflow = 'hidden';
      }

      function closeNativeLightbox() {
        lightboxModal.classList.remove('active');
        document.body.style.overflow = '';
      }

      if (lightboxCloseBtn) lightboxCloseBtn.addEventListener('click', closeNativeLightbox);
      if (lightboxZoomToggle) {
        lightboxZoomToggle.addEventListener('click', () => {
          isZoomed = !isZoomed;
          if (isZoomed) {
            lbScale = 2.5;
            lightboxZoomToggle.textContent = 'ZOOM: 250%';
          } else {
            lbScale = 1;
            lbPanX = 0;
            lbPanY = 0;
            lightboxZoomToggle.textContent = 'ZOOM: 100%';
          }
          updateLbTransform();
        });
      }

      if (lbViewport) {
        lbViewport.addEventListener('wheel', (e) => {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.25 : 0.8;
          lbScale = Math.min(Math.max(0.15, lbScale * factor), 20);
          updateLbTransform();
          if (lightboxZoomToggle) lightboxZoomToggle.textContent = `ZOOM: ${Math.round(lbScale * 100)}%`;
        }, { passive: false });

        lbViewport.addEventListener('mousedown', (e) => {
          isLbDragging = true;
          lbStartX = e.clientX - lbPanX;
          lbStartY = e.clientY - lbPanY;
          lbViewport.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
          if (!isLbDragging) return;
          lbPanX = e.clientX - lbStartX;
          lbPanY = e.clientY - lbStartY;
          updateLbTransform();
        });

        window.addEventListener('mouseup', () => {
          isLbDragging = false;
          if (lbViewport) lbViewport.style.cursor = 'grab';
        });
      }

      window.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          if (isTouchHaikuOpen) closeTouchHaikuModal();
          if (lightboxModal.classList.contains('active')) closeNativeLightbox();
        }
      });

      // HTML-safe text/attribute value (titles like "Children's Games" no longer show "Children\'s")
      function escapeAttr(str) {
        if (str === null || str === undefined) return '';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }
      // A JS string literal that is safe inside an HTML event attribute (onerror="…")
      function jsArg(str) {
        return escapeAttr(JSON.stringify(str === null || str === undefined ? '' : String(str)));
      }

      // ============================================================================
      // 8. VIEW: ARCHIVAL CAT HAIKU DOSSIER (#/dossier)
      // ============================================================================
      function renderDossierView(query = {}) {
        if (window.activeTimelineScrollHandler) {
          window.removeEventListener('scroll', window.activeTimelineScrollHandler);
          window.activeTimelineScrollHandler = null;
        }
        sideIndicator.style.display = 'none';
        mobileEraBar.style.display = 'none';
        tintOverlay.style.backgroundColor = 'transparent';

        const allDossierHaikus = (HAIKU_POOL && HAIKU_POOL.length > 0) ? HAIKU_POOL : HAIKU_SPECIMENS;
        const esc = escapeAttr;
        const heartSvg = saved => `<svg width="14" height="14" viewBox="0 0 24 24" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;

        // Group by poet; poets ordered by birth year, poems by year within each poet
        const poets = new Map();
        allDossierHaikus.forEach((h, idx) => {
          const name = h.author || 'Anonymous';
          if (!poets.has(name)) {
            poets.set(name, {
              name,
              jp: h.fullAuthorJp || h.authorJp || h.shortAuthorJp || '',
              life: h.lifespan || '',
              page: poetForAuthor(name),
              slug: 'dossier-poet-' + name.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase(),
              poems: []
            });
          }
          poets.get(name).poems.push({ ...h, id: h.id || String(idx + 1).padStart(3, '0') });
        });
        const born = p => parseInt(p.life, 10) || 9999;
        const poetList = [...poets.values()].sort((a, b) => born(a) - born(b) || a.name.localeCompare(b.name));
        poetList.forEach(p => p.poems.sort((a, b) => (parseInt(a.year, 10) || 0) - (parseInt(b.year, 10) || 0)));

        const indexHtml = poetList.map(p => `
          <li><button type="button" class="dossier-index-link" data-target="${p.slug}">
            <span class="dossier-index-name">${esc(p.name)}</span>
            <span class="dossier-index-count">${p.poems.length}</span>
            ${p.life ? `<span class="dossier-index-life">${esc(p.life)}</span>` : ''}
          </button></li>`).join('');

        let entryIdx = 0;
        const sectionsHtml = poetList.map(p => `
          <section class="dossier-poet" id="${p.slug}" aria-labelledby="${p.slug}-title">
            <header class="dossier-poet-head">
              <h2 id="${p.slug}-title">${p.page ? `<a class="dossier-poet-link" href="#/poet/${p.page.slug}" title="About ${esc(p.name)}">${esc(p.name)}</a>` : esc(p.name)}${p.jp ? `<span lang="ja">${esc(p.jp)}</span>` : ''}</h2>
              <span class="dossier-label">${[p.life, `${p.poems.length} ${p.poems.length === 1 ? 'poem' : 'poems'}`].filter(Boolean).join(' · ')}</span>
            </header>
            ${p.poems.map(h => {
              const isSaved = CuratorialStack.has('haiku:' + h.id) || CuratorialStack.has(h.id);
              const i = Math.min(entryIdx++, 10);
              return `
              <article id="haiku-card-${esc(h.id)}" class="dossier-entry stagger-in" style="--stagger-i:${i}">
                <div class="dossier-entry-num">${esc(h.id)}${h.year ? `<small>${esc(h.year)}</small>` : ''}</div>
                <div class="dossier-entry-jp"><div class="dossier-jp" lang="ja">${esc(h.jp || '')}</div></div>
                <div class="dossier-entry-text">
                  <p class="dossier-tr">${esc(h.en || h.literal || '')}</p>
                  ${h.romaji ? `<p class="dossier-romaji">${esc(h.romaji)}</p>` : ''}
                  ${h.notes ? `<p class="dossier-notes">${esc(h.notes)}</p>` : ''}
                  <div class="dossier-attr dossier-label">${p.page ? `<a class="dossier-poet-link" href="#/poet/${p.page.slug}">${esc(p.name)}</a>` : esc(p.name)}${p.jp ? `<span lang="ja">${esc(p.jp)}</span>` : ''}</div>
                </div>
                <button class="card-stack-btn dossier-save ${isSaved ? 'active' : ''}" data-haiku-id="haiku:${esc(h.id)}" title="Save haiku to Curatorial Stack" aria-label="Save haiku to stack" aria-pressed="${isSaved}" type="button" onclick="window.toggleHaikuStack('haiku:${esc(h.id)}', this);">${heartSvg(isSaved)}</button>
              </article>`;
            }).join('')}
          </section>`).join('');

        appRoot.innerHTML = `
          <div class="dossier-page-container">
            <header class="dossier-mast">
              <div class="dossier-label dossier-kicker">Archival Dossier · Literature</div>
              <h1>On the Stray Cat in Haiku<span lang="ja">猫の恋</span></h1>
              <div class="dossier-rule" aria-hidden="true"></div>
              <p class="dossier-abstract">In classical haikai the spring season word <em lang="ja">猫の恋</em> (<em>neko no koi</em>, “cat’s love”) rarely signifies domestic warmth. From Matsuo Bashō to Masaoka Shiki, poets recorded the stray returning from the rooftops: soaked in cold rain, thin from coarse barley, reduced to two gleaming eyes in the dark. The poems are given in their original vertical setting with an English reading and romanisation.</p>
            </header>
            <div class="dossier-body">
              <nav class="dossier-index" aria-label="Index of poets">
                <h2 class="dossier-label">Index of poets</h2>
                <ol>${indexHtml}</ol>
              </nav>
              <div id="dossier-specimens-list" class="dossier-reading">${sectionsHtml}</div>
            </div>
          </div>
        `;

        // Index: jump to a poet without touching the hash router, and track the poet in view
        const links = [...appRoot.querySelectorAll('.dossier-index-link')];
        const setActive = slug => links.forEach(l => l.classList.toggle('active', l.dataset.target === slug));
        links.forEach(l => l.addEventListener('click', () => {
          const target = document.getElementById(l.dataset.target);
          if (!target) return;
          const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
          setActive(l.dataset.target);
        }));
        if (window.dossierIndexObserver) window.dossierIndexObserver.disconnect();
        if ('IntersectionObserver' in window) {
          window.dossierIndexObserver = new IntersectionObserver(entries => {
            const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
            if (visible.length) setActive(visible[0].target.id);
          }, { rootMargin: '-20% 0px -70% 0px' });
          appRoot.querySelectorAll('.dossier-poet').forEach(s => window.dossierIndexObserver.observe(s));
        }
        if (poetList.length) setActive(poetList[0].slug);
        const wanted = query.poet && poetList.find(p => p.page && p.page.slug === query.poet);
        if (wanted) {
          // after navigate() has restored the scroll position for this route
          requestAnimationFrame(() => {
            const target = document.getElementById(wanted.slug);
            if (target) { target.scrollIntoView({ block: 'start' }); setActive(wanted.slug); }
          });
        }
      }

      // ============================================================================
      // 9. VIEW: POET BIOGRAPHY (#/poet/<slug>)
      // Portrait column (sticky, pinned by its bottom edge) beside Life and the cats note,
      // then a free-gliding horizontal timeline. Content lives in data/poets.json.
      // ============================================================================
      // Trusted text from data/poets.json: [label](url) links and *emphasis*; inline HTML
      // (lang spans) passes through. External links open in a new tab.
      function poetRichText(text) {
        return String(text || '')
          .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => url.startsWith('#')
            ? `<a class="poet-wl" href="${escapeAttr(url)}">${label}</a>`
            : `<a class="poet-wl" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`)
          .replace(/\*([^*]+)\*/g, '<em>$1</em>');
      }
      // Local WebP variants (assets/img) when built; the Wikimedia original otherwise
      const poetImgSrc = (img, w) => {
        const L = img.local;
        if (!L || !L.widths || !L.widths.length) return img.src;
        return `${L.base}-${L.widths.find(x => x >= w) || L.widths[L.widths.length - 1]}.webp`;
      };
      const poetSrcset = img => img.local && img.local.widths
        ? img.local.widths.map(x => `${img.local.base}-${x}.webp ${x}w`).join(', ')
        : `${img.src} ${img.w}w`;
      const poetNatW = img => (img.local && img.local.w) || img.w;

      function renderPoetView(slug) {
        sideIndicator.style.display = 'none';
        mobileEraBar.style.display = 'none';
        tintOverlay.style.backgroundColor = 'transparent';
        const esc = escapeAttr;
        const idx = POETS.findIndex(p => p.slug === slug);
        const poet = POETS[idx];

        if (!poet) {
          appRoot.innerHTML = `
            <div class="poet-page poet-missing">
              <header class="poet-mast"><h1>Poet not found</h1><div class="poet-rule" aria-hidden="true"></div></header>
              <p>There is no poet at this address. <a class="poet-wl" href="#/dossier">Back to the Haiku Dossier</a></p>
            </div>`;
          return;
        }

        const prev = POETS[idx - 1], next = POETS[idx + 1];
        const poems = (HAIKU_POOL || []).filter(h => h.author === poet.author);
        const featured = poems.slice(0, 3);
        const first = poet.name.split(' ').pop();
        // Each poet's cats and timeline headings (data/poets.json `headings`), with the plain names as fallback
        const heads = poet.headings || {};
        const moreLabel = poems.length === 1 ? `The one cat haiku by ${first} in the dossier`
          : poems.length === 2 ? `Both of ${first}’s cat haiku in the dossier`
          : `All ${poems.length} of ${first}’s cat haiku in the dossier`;

        // Portrait plate: the first image large, any others as a row of thumbnails
        const imgs = poet.images || [];
        const imgHtml = (img, i) => `
          <img class="poet-plate-img ${poetNatW(img) < 600 ? 'is-small' : ''}" src="${esc(poetImgSrc(img, 960))}"
            srcset="${esc(poetSrcset(img))}"
            sizes="(max-width: 860px) 280px, 320px" width="${poetNatW(img)}" height="${(img.local && img.local.h) || img.h}"
            ${poetNatW(img) < 600 ? `style="max-width:min(calc(100% - 48px), ${Math.round(poetNatW(img) * 1.25)}px)"` : ''}
            alt="${esc(img.caption)}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
        const capHtml = img => {
          const credit = img.credit && !img.caption.includes(img.credit) ? ` ${esc(img.credit)}.` : '';
          return `${esc(img.caption)}${credit} <a class="poet-cap-src" href="${esc(img.page)}" target="_blank" rel="noopener noreferrer">${esc(img.license)} · full size ↗</a>`;
        };
        const plateHtml = imgs.length ? `
          <figure class="poet-plate">
            <a class="poet-plate-frame" href="${esc(imgs[0].page)}" target="_blank" rel="noopener noreferrer" aria-label="Open the full-size image on Wikimedia Commons">${imgHtml(imgs[0], 0)}</a>
            <figcaption class="poet-plate-cap">${capHtml(imgs[0])}</figcaption>
            ${imgs.length > 1 ? `<div class="poet-thumbs" role="group" aria-label="More images">${imgs.map((img, i) => `
              <button type="button" class="poet-thumb ${i === 0 ? 'active' : ''}" data-i="${i}" aria-label="Show image ${i + 1} of ${imgs.length}" aria-pressed="${i === 0}">
                <img src="${esc(poetImgSrc(img, 160))}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>` : ''}
          </figure>` : `
          <figure class="poet-plate poet-plate-empty">
            <div class="poet-nameplate" lang="ja">${esc(poet.jp)}</div>
            <figcaption class="poet-plate-cap">No portrait of ${esc(poet.name)} with a clear public licence is available, so the name stands in for the face.</figcaption>
          </figure>`;

        // Timeline: one even row per event; the active years drawn as a rust bar on the line
        const yearNum = y => parseInt(String(y).replace(/[^0-9]/g, ''), 10);
        const tl = poet.timeline || [];
        const [from, to] = poet.active || [];
        const i0 = Math.max(0, tl.findIndex(e => e.kind !== 'after' && yearNum(e.year) >= from));
        let i1 = i0;
        tl.forEach((e, i) => { if (e.kind !== 'after' && yearNum(e.year) <= to) i1 = i; });
        const KIND = { life: 'v', work: 'o', after: 'p' };
        const tlHtml = tl.map((e, i) => {
          const k = KIND[e.kind] || 'v';
          const link = e.link ? `<a class="poet-src" href="${esc(e.link.url)}" target="_blank" rel="noopener noreferrer"${e.link.lang ? ` hreflang="${esc(e.link.lang)}"` : ''}>${esc(e.link.label)} ↗${e.link.lang === 'ja' ? '<span>in Japanese</span>' : ''}</a>` : '';
          return `<span class="poet-yr ${k}" style="grid-column:${i + 1}">${esc(e.year)}</span><span class="poet-dot ${k}" style="grid-column:${i + 1}" aria-hidden="true"></span><span class="poet-tx ${k}" style="grid-column:${i + 1}">${esc(e.text)}${link}</span>`;
        }).join('');

        const sourceLabel = url => /\/\/ja\./.test(url) ? 'Wikipedia (Japanese)' : /\/\/en\./.test(url) ? 'Wikipedia (English)' : url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];

        appRoot.innerHTML = `
          <div class="poet-page">
            <header class="poet-mast">
              <h1>${esc(poet.name)}</h1>
              <span class="poet-mast-jp" lang="ja">${esc(poet.jp)}</span>
              <div class="poet-mast-dates">${esc(poet.life.replace('–', ' — '))}</div>
              <div class="poet-rule" aria-hidden="true"></div>
            </header>

            <div class="poet-cols">
              <aside class="poet-side" aria-label="Portrait and asides">
                ${plateHtml}
                <h2 class="poet-h3">Asides</h2>
                <ul class="poet-asides">${(poet.asides || []).map(a => `<li><b>${esc(a.title)}</b><span>${poetRichText(a.text)}</span></li>`).join('')}</ul>
                <p class="poet-sources">Sources: ${(poet.sources || []).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${sourceLabel(u)}</a>`).join(' · ')}</p>
              </aside>

              <main class="poet-main">
                <h2 class="poet-h2">Life</h2>
                <div class="poet-life">${(poet.lifeText || []).map(par => `
                  <div class="poet-para"><span class="poet-per">${esc(par.years)}</span><p>${poetRichText(par.text)}</p></div>`).join('')}
                </div>

                ${poet.poem ? `<figure class="poet-dew">
                  <p class="poet-dew-jp" lang="ja">${esc(poet.poem.jp)}</p>
                  <p class="poet-dew-en">${esc(poet.poem.en)}</p>
                  ${poet.poem.note ? `<figcaption class="poet-dew-note">${esc(poet.poem.note)}</figcaption>` : ''}
                </figure>` : ''}

                <h2 class="poet-h2">${esc(heads.cats || first + ' and cats')}</h2>
                <div class="poet-note">${(poet.cats || []).map(c => `<p>${poetRichText(c)}</p>`).join('')}</div>
                ${featured.length ? `<ol class="poet-poems">${featured.map(h => `
                  <li><div><p class="poet-poem-jp" lang="ja">${esc(h.jp || '')}</p>
                    ${h.romaji ? `<p class="poet-poem-ro">${esc(h.romaji.replace(/ \/ /g, ' · '))}</p>` : ''}
                    <p class="poet-poem-en">${esc(h.en || h.literal || '')}</p></div></li>`).join('')}</ol>
                <a class="poet-more" href="#/dossier?poet=${esc(poet.slug)}">${esc(moreLabel)} →</a>` : ''}
              </main>
            </div>

            ${tl.length ? `<section class="poet-tl" aria-label="Timeline of ${esc(poet.name)}’s life and work">
              <div class="poet-tl-head">
                <div><h2 class="poet-h2">${esc(heads.timeline || 'Timeline')}</h2>
                  <div class="poet-legend"><span class="v"><i></i>Life</span><span class="o"><i></i>Work</span><span class="p"><i></i>Afterwards</span></div></div>
                <div class="poet-ctrl"><button type="button" data-step="-1" aria-label="Earlier years">‹</button><button type="button" data-step="1" aria-label="Later years">›</button></div>
              </div>
              <div class="poet-frame is-start"><div class="poet-track" tabindex="0" role="region" aria-label="Timeline, scrolls sideways">
                <div class="poet-rail" style="--i0:${i0};--i1:${i1}">
                  ${from ? `<div class="poet-act"><span>Active ${from}–${to}</span></div>` : ''}
                  ${tlHtml}
                </div></div></div>
              <div class="poet-mini" aria-hidden="true"><b></b></div>
            </section>` : ''}

            <nav class="poet-pager" aria-label="Poets">
              ${prev ? `<a class="poet-prev" href="#/poet/${esc(prev.slug)}"><span>Previous</span><strong>${esc(prev.name)}</strong></a>` : '<span></span>'}
              <a class="poet-all" href="#/dossier">All poets</a>
              ${next ? `<a class="poet-next" href="#/poet/${esc(next.slug)}"><span>Next</span><strong>${esc(next.name)}</strong></a>` : '<span></span>'}
            </nav>
          </div>`;

        const ctl = new AbortController();
        window.activePoetCleanup = ctl;
        const on = (el, ev, fn, opts = {}) => el && el.addEventListener(ev, fn, { ...opts, signal: ctl.signal });
        const page = appRoot.querySelector('.poet-page');

        // Thumbnails swap the plate image and its caption
        const plate = page.querySelector('.poet-plate');
        page.querySelectorAll('.poet-thumb').forEach(btn => on(btn, 'click', () => {
          const img = imgs[Number(btn.dataset.i)];
          plate.querySelector('.poet-plate-frame').href = img.page;
          plate.querySelector('.poet-plate-frame').innerHTML = imgHtml(img, 0);
          plate.querySelector('.poet-plate-cap').innerHTML = capHtml(img);
          page.querySelectorAll('.poet-thumb').forEach(b => {
            b.classList.toggle('active', b === btn);
            b.setAttribute('aria-pressed', String(b === btn));
          });
          pin();
        }));

        // The shorter left column scrolls with the page until its bottom is in view, then holds
        const side = page.querySelector('.poet-side');
        const headerH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 56;
        function pin() {
          if (!side) return;
          if (window.innerWidth <= 860) { side.style.top = ''; return; }
          side.style.top = Math.min(headerH() + 24, window.innerHeight - side.offsetHeight - 24) + 'px';
        }
        on(window, 'resize', pin);
        page.querySelectorAll('.poet-side img').forEach(img => on(img, 'load', pin));
        pin();

        // Timeline: buttons, keys, drag with a glide on release, fades and a position bar
        const frame = page.querySelector('.poet-frame');
        const track = page.querySelector('.poet-track');
        if (!track) return;
        const bar = page.querySelector('.poet-mini b');
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        function update() {
          const max = track.scrollWidth - track.clientWidth;
          const r = max > 0 ? track.scrollLeft / max : 0;
          const w = track.clientWidth / track.scrollWidth * 100;
          bar.style.width = w + '%';
          bar.style.left = (r * (100 - w)) + '%';
          frame.classList.toggle('is-start', r < 0.02);
          frame.classList.toggle('is-end', r > 0.98 || max <= 0);
        }
        page.querySelectorAll('.poet-ctrl [data-step]').forEach(b => on(b, 'click', () =>
          track.scrollBy({ left: Number(b.dataset.step) * track.clientWidth * 0.66, behavior: reduce ? 'auto' : 'smooth' })));
        on(track, 'scroll', update, { passive: true });
        on(window, 'resize', update);
        on(track, 'keydown', e => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          e.preventDefault();
          track.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * 300, behavior: reduce ? 'auto' : 'smooth' });
        });
        let drag = null, lastX = 0, vx = 0, raf = 0, moved = 0;
        const glide = () => {
          track.scrollLeft -= vx;
          vx *= 0.94;
          if (Math.abs(vx) > 0.4) raf = requestAnimationFrame(glide);
        };
        on(track, 'pointerdown', e => {
          if (e.pointerType !== 'mouse' || e.button !== 0) return; // touch scrolls natively
          cancelAnimationFrame(raf);
          drag = { x: e.clientX, s: track.scrollLeft };
          lastX = e.clientX; vx = 0; moved = 0;
          track.classList.add('is-dragging');
        });
        on(window, 'pointermove', e => {
          if (!drag) return;
          vx = e.clientX - lastX;
          lastX = e.clientX;
          track.scrollLeft = drag.s - (e.clientX - drag.x);
        });
        on(window, 'pointerup', () => {
          if (!drag) return;
          moved = Math.abs(track.scrollLeft - drag.s);
          drag = null;
          track.classList.remove('is-dragging');
          if (!reduce) raf = requestAnimationFrame(glide);
        });
        // A drag that ends on a link must not follow it
        on(track, 'click', e => { if (moved > 5) { e.preventDefault(); e.stopPropagation(); moved = 0; } }, { capture: true });
        ctl.signal.addEventListener('abort', () => cancelAnimationFrame(raf));
        update();
      }

      // Initialize living margins on start
      initMarginRibbons();
      animateMargins();

      // Hash routing initialization
      const supportsVT = typeof document.startViewTransition === 'function';
      if (supportsVT) document.documentElement.classList.add('vt-enabled');

      // ---- Shared-element morph: card image <-> artwork page hero ----
      const MORPH_NAME = 'artwork-hero';
      const WORK_LINK = '[onclick*="#/work/"], a[href^="#/work/"]';
      const workIdFromHash = h => { const m = /^#\/work\/([^?]+)/.exec(h || ''); return m ? decodeURIComponent(m[1]) : null; };
      const workIdFromLink = el => {
        const m = /#\/work\/([^'"?\s]+)/.exec(el.getAttribute('onclick') || el.getAttribute('href') || '');
        return m ? m[1] : null;
      };
      const inViewport = el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
      };
      // The image the user actually sees in a card (a multi-image slider has several)
      function visibleCardImage(card) {
        let best = null, bestArea = 0;
        card.querySelectorAll('img').forEach(img => {
          if (img.closest('.carousel-thumb-btn')) return;
          const r = img.getBoundingClientRect();
          const w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
          const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
          const area = Math.max(0, w) * Math.max(0, h);
          if (area > bestArea) { bestArea = area; best = img; }
        });
        return best;
      }
      // Back from an artwork: land on the card you opened (pixel scroll memory drifts because
      // off-screen timeline items render at placeholder heights), then morph into it.
      function cardImageForWork(id) {
        const btn = document.querySelector(`.card-stack-btn[data-work-id="${CSS.escape(id)}"]`);
        const card = btn && btn.closest('article, .specimen-mini-card');
        if (!card) return null;
        if (!inViewport(card)) card.scrollIntoView({ block: 'center', behavior: 'instant' });
        const img = visibleCardImage(card);
        return img && inViewport(img) ? img : null;
      }
      const heroImage = () => document.querySelector('.artwork-page-view .slide.is-active');

      let morphSource = null; // { id, img, at }
      document.addEventListener('click', e => {
        const link = e.target.closest && e.target.closest(WORK_LINK);
        if (!link || link.closest('.artwork-page-view')) { morphSource = null; return; }
        const id = workIdFromLink(link);
        const img = id && visibleCardImage(link);
        morphSource = img ? { id, img, at: performance.now() } : null;
      }, true);

      // The router restores scroll per route itself (scrollMemory). Native restoration jumped
      // the page before hashchange fired, so Back saved the wrong position and the hero was
      // already off-screen when the morph looked for it.
      try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}

      let lastHash = location.hash;
      window.addEventListener('hashchange', () => {
        const prevHash = lastHash;
        lastHash = location.hash;
        if (!supportsVT || Motion.reduced) { navigate(); return; }

        const toId = workIdFromHash(location.hash);
        const fromId = workIdFromHash(prevHash);
        let oldEl = null, findNew = null;
        if (toId && !fromId && morphSource && morphSource.id === toId &&
            performance.now() - morphSource.at < 1500 && morphSource.img.isConnected) {
          oldEl = morphSource.img;                       // card -> artwork page
          findNew = heroImage;
        } else if (fromId && !toId) {
          oldEl = heroImage();                           // artwork page -> back to a list
          findNew = () => cardImageForWork(fromId);
        }
        morphSource = null;
        if (oldEl && !inViewport(oldEl)) oldEl = null;
        if (oldEl) oldEl.style.viewTransitionName = MORPH_NAME;

        let newEl = null;
        const vt = document.startViewTransition(() => {
          if (oldEl) oldEl.style.viewTransitionName = '';
          navigate();
          if (!oldEl || !findNew) return;
          newEl = findNew();
          if (!newEl) return;
          newEl.style.viewTransitionName = MORPH_NAME;
          // A just-rendered card image waits behind its placeholder; show it now and give it a
          // moment to decode (it is cached) so the morph lands on the picture, not a blank.
          newEl.classList.add('is-loaded');
          if (!newEl.decode) return;
          return Promise.race([newEl.decode().catch(() => {}), new Promise(r => setTimeout(r, 150))]);
        });
        // A second quick navigation skips this transition; its promises then reject, which is
        // expected, not an error worth reporting
        vt.ready.catch(() => {});
        vt.finished.catch(() => {}).finally(() => { if (newEl) newEl.style.viewTransitionName = ''; });
      });

      // ---- Hover prefetch: decode the artwork page's hero before the click lands ----
      const prefetched = new Set();
      let prefetchTimer = 0;
      if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        document.addEventListener('pointerover', e => {
          const link = e.target.closest && e.target.closest(WORK_LINK);
          if (!link) return;
          const id = workIdFromLink(link);
          if (!id || prefetched.has(id)) return;
          clearTimeout(prefetchTimer);
          prefetchTimer = setTimeout(() => {
            const work = artworkSlugMap.get(id);
            const url = work && getArtworkImages(work)[0];
            if (!url) return;
            prefetched.add(id);
            const img = new Image();
            img.decoding = 'async';
            img.src = displayUrl(work, url, 1400); // same URL the hero will request
            if (img.decode) img.decode().catch(() => {});
          }, 80); // ignore pointers just passing over
        }, { passive: true });
      }
      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', navigate);
      } else {
        navigate();
      }

    })(); } catch (err) { console.error("[Historia Felis] app init failed:", err); }

    // ============================================================================
    // Prologue — first-session title card (Web Animations, no per-frame layout)
    //   0.1s  0–13 era numerals step in
    //   0.25s title rises out of its baseline mask; hairline draws across
    //   0.6s  year counter runs the length of the archive, ringing each era
    //   3.0s  furniture falls away, title glides into the header mark,
    //         paper lifts to reveal the site underneath
    // Unskippable: while it runs, keys, wheel and touch-scroll are swallowed.
    // ============================================================================
    (function initFelisCinematicIntro() {
      const STORAGE_KEY = 'felis_intro_day'; // value = day key (rolls over 21:37 Vatican time)
      const dayKey = () => (window.felisIntroDayKey ? window.felisIntroDayKey() : new Date().toISOString().slice(0, 10));
      const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
      const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';
      const HOLD_MS = 3000;

      const overlay = document.getElementById('felis-cinema-intro');
      const title = document.getElementById('cinema-morph-logo');
      const headerLogo = document.getElementById('header-brand-title');
      const audioEl = document.getElementById('felis-intro-audio');
      if (!overlay || !title || !headerLogo) return;

      const slot = overlay.querySelector('.prologue-title-slot');
      const card = overlay.querySelector('.prologue-card');
      const indexRow = overlay.querySelector('.prologue-index');
      const rule = overlay.querySelector('.prologue-rule');
      const meta = overlay.querySelector('.prologue-meta');
      const yearEl = document.getElementById('prologue-year');

      const store = {
        get() { try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; } },
        set() { try { localStorage.setItem(STORAGE_KEY, dayKey()); } catch (e) {} }
      };

      // Timeline span and era order come from the era categories (the same data the
      // timeline renders), and the numerals mirror the header index one-for-one.
      let eraById = {};
      try {
        const raw = JSON.parse(document.getElementById('data-categories').textContent || '[]');
        (Array.isArray(raw) ? raw : (raw.categories || []))
          .filter(c => c.level === 'era')
          .forEach(c => { eraById[c.id] = c; });
      } catch (e) {}
      const headerEras = Array.from(document.querySelectorAll('#era-index-bar .era-num'))
        .map(a => eraById[a.dataset.eraId])
        .filter(Boolean);
      const knownEras = Object.values(eraById);
      const yearFrom = knownEras.length ? Math.min(...knownEras.map(e => e.start_year)) : -40000;
      const yearTo = knownEras.length ? Math.max(...knownEras.map(e => e.end_year)) : 2026;

      indexRow.innerHTML = headerEras.map((_, i) => '<li>' + i + '</li>').join('');
      const numerals = Array.from(indexRow.children);

      // When each numeral lights up as the counter runs. Eras are listed in timeline
      // order, which isn't strictly chronological (the Americas sit after mid-century),
      // so out-of-order starts are slotted between their neighbours to keep the sweep left-to-right.
      const eraCues = headerEras.map(e => e.start_year);
      for (let i = 1; i < eraCues.length; i++) {
        if (eraCues[i] <= eraCues[i - 1]) {
          const next = eraCues.slice(i + 1).find(y => y > eraCues[i - 1]);
          eraCues[i] = next !== undefined ? (eraCues[i - 1] + next) / 2 : eraCues[i - 1] + 1;
        }
      }
      if (eraCues.length) eraCues[0] = -Infinity;

      const fmtYear = y => y < 0 ? Math.abs(Math.round(y)).toLocaleString('en-US') + ' BCE' : String(Math.round(y));
      const fullSpan = () => fmtYear(yearFrom) + ' — ' + fmtYear(yearTo);
      const eraOf = y => { let i = 0; while (i + 1 < eraCues.length && y >= eraCues[i + 1]) i++; return i; };

      let anims = [];
      let timers = [];
      let counterRaf = null;
      let exiting = false;
      let running = false;

      function play(el, keyframes, opts) {
        const a = el.animate(keyframes, Object.assign({ fill: 'both' }, opts));
        anims.push(a);
        return a;
      }

      function reset() {
        anims.forEach(a => a.cancel());
        anims = [];
        timers.forEach(clearTimeout);
        timers = [];
        if (counterRaf) cancelAnimationFrame(counterRaf);
        counterRaf = null;
        exiting = false;
        slot.style.overflow = '';
        [title, rule, meta, indexRow, overlay].forEach(el => { el.style.opacity = ''; el.style.transform = ''; el.style.backgroundColor = ''; });
        numerals.forEach(li => { li.classList.remove('is-past', 'is-current'); li.style.opacity = ''; li.style.transform = ''; });
        yearEl.textContent = fmtYear(yearFrom);
      }

      // The big title uses the header mark's exact weight and tracking, so the
      // glide is a pure scale-down: crisp on every frame, no metric jump on landing.
      function fitTitle() {
        const cs = getComputedStyle(headerLogo);
        const fs = parseFloat(cs.fontSize) || 11.5;
        const lsEm = (parseFloat(cs.letterSpacing) || 0) / fs;
        const perPx = headerLogo.getBoundingClientRect().width / fs; // width per 1px of font-size
        const avail = card.getBoundingClientRect().width;
        const big = Math.min(144, Math.max(28, avail / Math.max(0.1, perPx - lsEm)));
        title.style.fontWeight = cs.fontWeight;
        title.style.letterSpacing = lsEm + 'em';
        title.style.fontSize = big + 'px';
        title.style.marginRight = (-lsEm) + 'em'; // trailing tracking shouldn't push the right edge
      }

      function runCounter(start, duration) {
        let lastEra = -1;
        const step = now => {
          const t = Math.min(1, Math.max(0, (now - start) / duration));
          const e = 1 - Math.pow(1 - t, 3);
          const y = yearFrom + (yearTo - yearFrom) * e;
          yearEl.textContent = fmtYear(y);
          const era = eraOf(y);
          if (era !== lastEra) {
            numerals.forEach((li, i) => {
              li.classList.toggle('is-past', i < era);
              li.classList.toggle('is-current', i === era);
            });
            lastEra = era;
          }
          if (t < 1) counterRaf = requestAnimationFrame(step);
          else { counterRaf = null; yearEl.textContent = fullSpan(); }
        };
        counterRaf = requestAnimationFrame(step);
      }

      function fadeAudio(ms) {
        if (!audioEl || audioEl.paused) return;
        const v0 = audioEl.volume, t0 = performance.now();
        const tick = now => {
          const t = Math.min(1, (now - t0) / ms);
          audioEl.volume = v0 * (1 - t);
          if (t < 1) requestAnimationFrame(tick);
          else { audioEl.pause(); audioEl.currentTime = 0; audioEl.volume = v0; }
        };
        requestAnimationFrame(tick);
      }

      // Swallow input at the window (capture) so nothing underneath reacts or scrolls
      const BLOCKED_EVENTS = ['keydown', 'wheel', 'touchmove'];
      function swallow(e) { if (e.cancelable) e.preventDefault(); e.stopImmediatePropagation(); }
      function lockInput() {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        BLOCKED_EVENTS.forEach(t => window.addEventListener(t, swallow, { capture: true, passive: false }));
      }
      function unlockInput() { BLOCKED_EVENTS.forEach(t => window.removeEventListener(t, swallow, { capture: true })); }

      function exit() {
        if (exiting || !running) return;
        exiting = true;
        timers.forEach(clearTimeout);
        timers = [];
        if (counterRaf) { cancelAnimationFrame(counterRaf); counterRaf = null; }
        yearEl.textContent = fullSpan();

        // Freeze anything mid-flight at its current value before layering exit motion
        anims.forEach(a => { try { a.commitStyles(); } catch (e) {} a.cancel(); });
        anims = [];

        const k = 1;
        fadeAudio(900 * k);

        [rule, meta, indexRow].forEach(el => play(el,
          [{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }],
          { duration: 300 * k, easing: 'linear' }));

        // FLIP: measure at rest, then glide into the header mark's box
        title.style.transform = 'none';
        slot.style.overflow = 'visible';
        const first = title.getBoundingClientRect();
        const last = headerLogo.getBoundingClientRect();
        const s = (parseFloat(getComputedStyle(headerLogo).fontSize) || 11.5) / parseFloat(title.style.fontSize);
        const dx = last.left - first.left;
        const dy = last.top - first.top;
        const glide = play(title, [
          { transform: 'translate(0px, 0px) scale(1)' },
          { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + s + ')' }
        ], { duration: 1050 * k, delay: 120 * k, easing: EASE_IN_OUT });

        // Paper lifts while the title is still travelling, so the site arrives beneath it
        const bg = getComputedStyle(overlay).backgroundColor;
        play(overlay, [{ backgroundColor: bg }, { backgroundColor: 'rgba(0, 0, 0, 0)' }],
          { duration: 700 * k, delay: 450 * k, easing: 'linear' });

        glide.finished.then(finish, () => {});
      }

      function finish() {
        if (!running) return;
        running = false;
        unlockInput();
        store.set();
        document.documentElement.classList.add('skip-intro');
        document.body.classList.remove('intro-locked');
        reset();
      }

      function start() {
        reset();
        running = true;
        document.documentElement.classList.remove('skip-intro');
        document.body.classList.add('intro-locked');
        fitTitle();
        // Measured against fallback metrics until Geist arrives; refit once it has
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(() => { if (running && !exiting) fitTitle(); });
        }

        if (audioEl) {
          try {
            audioEl.currentTime = 0;
            audioEl.volume = 0.1;
            const p = audioEl.play();
            // Browsers block autoplay until the page has had a user gesture. If so, start the
            // music on the first gesture while the prologue is still running (visuals don't depend on it).
            if (p && p.catch) p.catch(() => {
              const evs = ['pointerdown', 'touchend', 'click', 'keydown'];
              const retry = () => {
                evs.forEach(t => window.removeEventListener(t, retry, true));
                if (!running || exiting) return;
                try { audioEl.volume = 0.1; const q = audioEl.play(); if (q && q.catch) q.catch(() => {}); } catch (e) {}
              };
              evs.forEach(t => window.addEventListener(t, retry, true));
            });
          } catch (e) {}
        }

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          numerals.forEach(li => { li.style.opacity = '1'; li.style.transform = 'none'; });
          rule.style.transform = 'none';
          meta.style.opacity = '1';
          yearEl.textContent = fullSpan();
          timers.push(setTimeout(() => {
            play(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: 400 }).finished.then(finish, () => {});
          }, 1800));
          lockInput();
          return;
        }

        numerals.forEach((li, i) => play(li,
          [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0px)' }],
          { duration: 420, delay: 100 + i * 40, easing: EASE_OUT }));

        play(title, [{ transform: 'translateY(105%)' }, { transform: 'translateY(0%)' }],
          { duration: 1100, delay: 250, easing: EASE_OUT });

        play(rule, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
          { duration: 1300, delay: 450, easing: EASE_IN_OUT });

        play(meta, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0px)' }],
          { duration: 600, delay: 900, easing: EASE_OUT });

        runCounter(performance.now() + 600, 1700);
        timers.push(setTimeout(exit, HOLD_MS));
        lockInput();
      }

      window.addEventListener('resize', () => { if (running && !exiting) fitTitle(); });

      if (store.get() === dayKey()) {
        document.documentElement.classList.add('skip-intro');
      } else {
        // Gate first: the click is the user gesture browsers require before sound can play.
        const gate = document.getElementById('prologue-gate');
        if (!gate) {
          overlay.classList.remove('is-gated');
          start();
        } else {
          document.body.classList.add('intro-locked');
          try { gate.focus({ preventScroll: true }); } catch (e) {}
          gate.addEventListener('click', () => {
            gate.disabled = true;
            gate.classList.add('is-leaving');
            overlay.classList.remove('is-gated');
            start(); // inside the click handler, so audio.play() is allowed
            setTimeout(() => gate.remove(), 700);
          }, { once: true });
        }
      }
    })();
