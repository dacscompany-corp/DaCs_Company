// Global widgets on every public page: approved testimonials, the feedback ★ modal (always inserts 'pending' — RLS testi_create), and the draggable Messenger / feedback buttons.

// ===========================
// Testimonials / Feedback
// ===========================
let selectedRating = 0;

// Load testimonials
async function loadTestimonials() {
    const container = document.getElementById('testimonialsGrid');
    if (!container) return; // the grid is part of the Home page markup
    try {
        const snapshot = await db.collection('testimonials').get();
        
        if (snapshot.empty) {
            container.innerHTML = '<p class="testi-empty">Be the first to share your experience — tap the ★ button to leave feedback.</p>';
            return;
        }
        
        // Filter approved 4-5 star ratings
        const testimonials = snapshot.docs
            .map(doc => doc.data())
            .filter(data => data.status === 'approved' && data.rating >= 4)
            .sort((a, b) => {
                if (b.createdAt && a.createdAt) {
                    return b.createdAt.toMillis() - a.createdAt.toMillis();
                }
                return 0;
            })
            .slice(0, 6);
        
        if (testimonials.length === 0) {
            container.innerHTML = '<p class="testi-empty">Be the first to share your experience — tap the ★ button to leave feedback.</p>';
            return;
        }
        
        // Testimonials are public submissions rendered to every visitor —
        // escape all fields (and clamp rating: '★'.repeat throws on negatives).
        const esc = s => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        container.innerHTML = testimonials.map(data => {
            const initials = String(data.name || '').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const r = Math.max(0, Math.min(5, parseInt(data.rating, 10) || 0));
            const stars = '★'.repeat(r) + '☆'.repeat(5 - r);

            return `
                <figure class="testi-card">
                    <div class="testi-stars" aria-label="${r} out of 5">${stars}</div>
                    <blockquote class="testi-text">${esc(data.message)}</blockquote>
                    <figcaption class="testi-author">
                        <span class="testi-avatar">${esc(initials)}</span>
                        <span><strong>${esc(data.name)}</strong><span>${esc(data.location)}</span></span>
                    </figcaption>
                </figure>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading testimonials:', error);
        container.innerHTML = '<p class="testi-empty">Be the first to share your experience — tap the ★ button to leave feedback.</p>';
    }
}

// Open feedback modal
document.getElementById('feedbackBtn').addEventListener('click', () => {
    document.getElementById('feedbackModal').classList.add('show');
    document.body.style.overflow = 'hidden';
    document.getElementById('feedbackName').focus();
});

// Keyboard: Esc closes; Tab wraps inside the open modal (it is aria-modal).
function feedbackModalOpen() {
    return document.getElementById('feedbackModal').classList.contains('show');
}
document.addEventListener('dacs:escape', () => { if (feedbackModalOpen()) closeFeedbackModal(); });
document.getElementById('feedbackModal').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = Array.from(document.getElementById('feedbackModal')
        .querySelectorAll('button, input:not([type="hidden"]), textarea, a[href]')).filter(el => !el.disabled);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

function closeFeedbackModal() {
    document.getElementById('feedbackModal').classList.remove('show');
    document.body.style.overflow = 'auto';
    document.getElementById('feedbackForm').reset();
    selectedRating = 0;
    document.querySelectorAll('.star').forEach(s => { s.classList.remove('active'); s.setAttribute('aria-pressed', 'false'); });
    document.getElementById('feedbackFormMessage').style.display = 'none';
    document.getElementById('feedbackBtn').focus();
}

// Star rating
document.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', function() {
        selectedRating = parseInt(this.dataset.rating);
        document.getElementById('feedbackRating').value = selectedRating;
        
        document.querySelectorAll('.star').forEach((s, index) => {
            if (index < selectedRating) {
                s.classList.add('active');
            } else {
                s.classList.remove('active');
            }
            s.setAttribute('aria-pressed', String(index === selectedRating - 1));
        });
    });
});

// Submit feedback
document.getElementById('feedbackForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (selectedRating === 0) {
        showFeedbackMessage('Please select a rating.', 'error');
        return;
    }
    
    // Always pending: RLS (testi_create) only accepts 'pending' from the public,
    // so an admin approves every review before it is shown.
    const feedbackData = {
        name: document.getElementById('feedbackName').value,
        location: document.getElementById('feedbackLocation').value,
        rating: selectedRating,
        message: document.getElementById('feedbackMessage').value,
        status: 'pending'
    };
    
    const submitBtn = e.target.querySelector('.btn-primary');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Submitting...';
    submitBtn.disabled = true;
    
    try {
        // Plain insert, no read-back — a pending row is not publicly readable.
        const { error } = await sb.from('testimonials').insert(feedbackData);
        if (error) throw error;

        showFeedbackMessage('Thank you for your feedback! It will appear on our site once reviewed.', 'success');

        setTimeout(closeFeedbackModal, 2000);
    } catch (error) {
        console.error('Error submitting feedback:', error);
        _dacsReportError('error', 'Feedback submit failed: ' + ((error && error.message) || error), 'js/site-widgets.js', 0, 0, error && error.stack);
        showFeedbackMessage('Error submitting feedback. Please try again.', 'error');
    } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
});

function showFeedbackMessage(message, type) {
    const msgEl = document.getElementById('feedbackFormMessage');
    msgEl.textContent = message;
    msgEl.style.display = 'block';
    msgEl.className = `form-message ${type}`;
}

// Load testimonials on page load
if (typeof db !== 'undefined') {
    loadTestimonials();
}

// ===========================
// Draggable floating buttons (Messenger + Feedback)
// ===========================
function makeDraggable(el, storageKey) {
    if (!el) return;

    const DRAG_THRESHOLD = 6; // px of movement before it counts as a drag, not a click
    let startY = 0;
    let originTop = 0;
    let dragging = false;
    let moved = false;

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    // Vertical-only: slides up/down the right edge, like a bookmark tab. Horizontal (right: 0) never changes.
    function applyTop(top) {
        const rect = el.getBoundingClientRect();
        const maxTop = window.innerHeight - rect.height;
        top = clamp(top, 0, Math.max(0, maxTop));
        el.style.top = `${top}px`;
        el.style.bottom = 'auto';
        return top;
    }

    function restorePosition() {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
            if (saved && typeof saved.top === 'number') {
                applyTop(saved.top);
            }
        } catch (e) { /* ignore malformed storage */ }
    }

    function savePosition(top) {
        try {
            localStorage.setItem(storageKey, JSON.stringify({ top }));
        } catch (e) { /* storage unavailable, skip persistence */ }
    }

    function onPointerDown(e) {
        if (e.button !== undefined && e.button !== 0) return; // left click / primary touch only
        const rect = el.getBoundingClientRect();
        startY = e.clientY;
        originTop = rect.top;
        dragging = true;
        moved = false;
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* capture not available, drag still works via document listeners */ }
        el.classList.add('is-dragging');
    }

    function onPointerMove(e) {
        if (!dragging) return;
        const dy = e.clientY - startY;
        if (!moved && Math.abs(dy) > DRAG_THRESHOLD) moved = true;
        if (moved) {
            applyTop(originTop + dy);
        }
    }

    function onPointerUp(e) {
        if (!dragging) return;
        dragging = false;
        el.classList.remove('is-dragging');
        try { el.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
        if (moved) {
            const rect = el.getBoundingClientRect();
            const finalTop = applyTop(rect.top);
            savePosition(finalTop);
            // Swallow the click that follows a real drag so it doesn't also open the link/modal
            const suppressClick = ev => { ev.preventDefault(); ev.stopPropagation(); el.removeEventListener('click', suppressClick, true); };
            el.addEventListener('click', suppressClick, true);
        }
        moved = false;
    }

    el.addEventListener('pointerdown', onPointerDown);
    // Listen on document too (not just el) so a drag keeps tracking even if pointer
    // capture doesn't stick between successive drags — this is what let the first
    // drag work but later ones silently fail and fall through to a click.
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    // The Messenger button is an <a>, and browsers natively let you drag links
    // (e.g. to a new tab) — that native drag competes with ours, so block it.
    el.addEventListener('dragstart', e => e.preventDefault());

    window.addEventListener('resize', () => {
        if (el.style.top === '') return; // still at default fixed position
        applyTop(el.getBoundingClientRect().top);
    });

    restorePosition();
}

makeDraggable(document.getElementById('messengerBtn'), 'dacs_messengerBtnPos');
makeDraggable(document.getElementById('feedbackBtn'), 'dacs_feedbackBtnPos');