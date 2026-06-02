// ===========================
// Navbar scroll effect
// ===========================
const navbar = document.getElementById('navbar');
let lastScroll = 0;

window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;
    if (currentScroll > 50) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
    lastScroll = currentScroll;
});

// ===========================
// Mobile menu toggle
// ===========================
const mobileMenuToggle = document.getElementById('mobileMenuToggle');
const navLinks = document.querySelector('.nav-links');

mobileMenuToggle.addEventListener('click', () => {
    navLinks.classList.toggle('active');
    mobileMenuToggle.classList.toggle('active');
});

// ===========================
// Smooth scrolling for nav links
// ===========================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            const offsetTop = target.offsetTop - 80;
            window.scrollTo({ top: offsetTop, behavior: 'smooth' });
            navLinks.classList.remove('active');
            mobileMenuToggle.classList.remove('active');
            document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
            this.classList.add('active');
        }
    });
});

// ===========================
// Intersection Observer – scroll animations
// ===========================
const observerOptions = { threshold: 0.1, rootMargin: '0px 0px -50px 0px' };

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

document.querySelectorAll('section, .about-card, .value-card, .team-member, .objective-step').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(el);
});

// ===========================
// Background Slideshow – auto-play every 10 seconds
// ===========================
let currentSlide = 0;
const bgSlides = document.querySelectorAll('.bg-slide');

if (bgSlides.length > 0) bgSlides[0].classList.add('bg-active');

function showSlide(index) {
    bgSlides.forEach(s => s.classList.remove('bg-active'));
    bgSlides[index].classList.add('bg-active');
}

function nextBgSlide() {
    currentSlide = (currentSlide + 1) % bgSlides.length;
    showSlide(currentSlide);
}

if (bgSlides.length > 1) setInterval(nextBgSlide, 10000);

// ===========================
// Form submission handler
// ===========================
const appointmentForm = document.getElementById('appointmentForm');
const formMessage     = document.getElementById('formMessage');

appointmentForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = {
        fullname:  document.getElementById('fullname').value,
        email:     document.getElementById('email').value,
        contact:   document.getElementById('contact').value,
        service:   document.getElementById('service').value,
        message:   document.getElementById('message').value,
        status:    'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (!formData.fullname || !formData.email || !formData.contact || !formData.service) {
        showMessage('Please fill in all required fields.', 'error');
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
        showMessage('Please enter a valid email address.', 'error');
        return;
    }

    const submitButton = appointmentForm.querySelector('.btn-submit');
    const originalText = submitButton.textContent;
    submitButton.textContent = 'Submitting...';
    submitButton.disabled = true;

    try {
        await db.collection('appointments').add(formData);
        showMessage('Thank you! Your appointment request has been received. We will contact you within 24 hours.', 'success');
        appointmentForm.reset();
        formMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
        console.error('Error submitting appointment:', error);
        showMessage('Sorry, there was an error submitting your request. Please try again or contact us directly.', 'error');
    } finally {
        submitButton.textContent = originalText;
        submitButton.disabled = false;
    }
});

function showMessage(message, type) {
    formMessage.textContent = message;
    formMessage.className = `form-message ${type}`;
    if (type === 'success') {
        setTimeout(() => { formMessage.style.display = 'none'; }, 5000);
    }
}

// ===========================
// Parallax effect for hero decoration (desktop only)
// ===========================
window.addEventListener('scroll', () => {
    const decoration = document.querySelector('.hero-decoration');
    if (decoration && window.innerWidth > 1024) {
        decoration.style.transform = `translateY(${window.pageYOffset * 0.3}px)`;
    }
});

// ===========================
// Floating cards hover effect
// ===========================
document.querySelectorAll('.floating-card').forEach(card => {
    card.addEventListener('mouseenter', () => {
        card.style.animationPlayState = 'paused';
        card.style.transform = 'scale(1.05)';
    });
    card.addEventListener('mouseleave', () => {
        card.style.animationPlayState = 'running';
        card.style.transform = 'scale(1)';
    });
});

// ===========================
// Update active nav link on scroll
// ===========================
window.addEventListener('scroll', () => {
    const sections = document.querySelectorAll('section[id]');
    const scrollY  = window.pageYOffset;

    sections.forEach(section => {
        const sectionTop = section.offsetTop - 100;
        const sectionId  = section.getAttribute('id');
        if (scrollY > sectionTop && scrollY <= sectionTop + section.offsetHeight) {
            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === `#${sectionId}`) link.classList.add('active');
            });
        }
    });
});

// ===========================
// Image loading animation
// ===========================
document.querySelectorAll('.card-image-wrap img').forEach(img => {
    img.style.opacity = '1';
    img.style.transition = 'opacity 0.5s ease';
    img.style.display = 'block';
    img.addEventListener('load', () => { 
        img.style.opacity = '1';
        img.style.display = 'block';
    });
});

// ===========================
// Hero animations on page load
// ===========================
window.addEventListener('load', () => {
    document.querySelectorAll('.hero-badge, .hero-title, .hero-subtitle, .hero-cta').forEach((el, i) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, i * 200);
    });
});

// ===========================
// Form field focus interactions
// ===========================
document.querySelectorAll('.form-group input, .form-group select, .form-group textarea').forEach(field => {
    field.addEventListener('focus', () => field.parentElement.classList.add('focused'));
    field.addEventListener('blur',  () => { if (!field.value) field.parentElement.classList.remove('focused'); });
});

// ===========================
// Value cards icon hover
// ===========================
document.querySelectorAll('.value-card').forEach(card => {
    const icon = card.querySelector('.value-icon');
    card.addEventListener('mouseenter', () => {
        icon.style.transform  = 'translateY(-10px) scale(1.1)';
        icon.style.transition = 'transform 0.3s ease';
    });
    card.addEventListener('mouseleave', () => { icon.style.transform = 'translateY(0) scale(1)'; });
});

// ===========================
// Card Slider – Clean & Reliable
// ===========================
(function () {
    const track   = document.querySelector('.carousel-track');
    const cards   = document.querySelectorAll('.carousel-card');
    const dots    = document.querySelectorAll('.carousel-dot');
    const prevBtn = document.getElementById('carouselPrev');
    const nextBtn = document.getElementById('carouselNext');
    const counter = document.querySelector('.carousel-counter');

    if (!track || cards.length === 0) return;

    let idx = 0;
    const total = cards.length;

    function goTo(i) {
        idx = ((i % total) + total) % total;
        track.style.transform = `translateX(-${idx * 100}%)`;
        dots.forEach((d, j) => d.classList.toggle('active', j === idx));
        if (counter) counter.textContent = `${idx + 1} / ${total}`;
    }

    function next() { goTo(idx + 1); }
    function prev() { goTo(idx - 1); }

    // Arrows
    if (prevBtn) prevBtn.addEventListener('click', () => { prev(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { next(); });

    // Dots
    dots.forEach((d, i) => d.addEventListener('click', () => { goTo(i); }));

    // Keyboard
    document.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft')  { prev(); }
        if (e.key === 'ArrowRight') { next(); }
    });

    // Touch swipe
    let touchStartX = 0;
    track.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    track.addEventListener('touchend',   e => {
        const diff = touchStartX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 40) { diff > 0 ? next() : prev(); }
    });

    goTo(0);
    
    // Attach lightbox handlers after carousel init
    setTimeout(attachImageClickHandlers, 500);

    console.log("DAC's Building Design Services – Website Loaded Successfully");
    console.log('Card Slider initialized with', total, 'cards');
})();

// ===========================
// Testimonials / Feedback
// ===========================
let selectedRating = 0;

// Load testimonials
async function loadTestimonials() {
    const container = document.getElementById('testimonialsGrid');
    try {
        const snapshot = await db.collection('testimonials').get();
        
        if (snapshot.empty) {
            container.innerHTML = '<p class="loading-text">No testimonials yet. Be the first to share your experience!</p>';
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
            container.innerHTML = '<p class="loading-text">No testimonials yet. Be the first to share your experience!</p>';
            return;
        }
        
        container.innerHTML = testimonials.map(data => {
            const initials = data.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const stars = '★'.repeat(data.rating) + '☆'.repeat(5 - data.rating);
            
            return `
                <div class="testimonial-card">
                    <div class="testimonial-quote">"</div>
                    <div class="testimonial-stars">${stars}</div>
                    <p class="testimonial-text">"${data.message}"</p>
                    <div class="testimonial-author">
                        <div class="testimonial-avatar">${initials}</div>
                        <div class="testimonial-info">
                            <h4>${data.name}</h4>
                            <p>Client from ${data.location}</p>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading testimonials:', error);
        container.innerHTML = '<p class="loading-text">No testimonials yet. Be the first to share your experience!</p>';
    }
}

// Open feedback modal
document.getElementById('feedbackBtn').addEventListener('click', () => {
    document.getElementById('feedbackModal').classList.add('show');
    document.body.style.overflow = 'hidden';
});

function closeFeedbackModal() {
    document.getElementById('feedbackModal').classList.remove('show');
    document.body.style.overflow = 'auto';
    document.getElementById('feedbackForm').reset();
    selectedRating = 0;
    document.querySelectorAll('.star').forEach(s => s.classList.remove('active'));
    document.getElementById('feedbackFormMessage').style.display = 'none';
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
    
    // Auto-approve 4-5 stars, manual approval for 1-3 stars
    const autoApprove = selectedRating >= 4;
    
    const feedbackData = {
        name: document.getElementById('feedbackName').value,
        location: document.getElementById('feedbackLocation').value,
        rating: selectedRating,
        message: document.getElementById('feedbackMessage').value,
        status: autoApprove ? 'approved' : 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    const submitBtn = e.target.querySelector('.btn-primary');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Submitting...';
    submitBtn.disabled = true;
    
    try {
        await db.collection('testimonials').add(feedbackData);
        
        if (autoApprove) {
            showFeedbackMessage('Thank you for your feedback! Your review is now live on our website.', 'success');
        } else {
            showFeedbackMessage('Thank you for your feedback! It will be reviewed and published soon.', 'success');
        }
        
        setTimeout(() => {
            closeFeedbackModal();
            // Reload testimonials if auto-approved
            if (autoApprove && typeof loadTestimonials === 'function') {
                loadTestimonials();
            }
        }, 2000);
    } catch (error) {
        console.error('Error submitting feedback:', error);
        showFeedbackMessage('Error submitting feedback. Please try again.', 'error');
    } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
});

function showFeedbackMessage(message, type) {
    const msgEl = document.getElementById('feedbackFormMessage');
    msgEl.textContent = message;
    msgEl.className = `form-message ${type}`;
}

// Load testimonials on page load
if (typeof db !== 'undefined') {
    loadTestimonials();
}

// ===========================
// Animated Stats Counter
// ===========================
function animateCounter(el, target, duration) {
    let start = 0;
    const increment = target / (duration / 16);
    const timer = setInterval(() => {
        start += increment;
        if (start >= target) {
            el.textContent = target;
            clearInterval(timer);
        } else {
            el.textContent = Math.floor(start);
        }
    }, 16);
}

const statsObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.querySelectorAll('.stat-number').forEach(num => {
                const target = parseInt(num.getAttribute('data-target'));
                animateCounter(num, target, 1500);
            });
            statsObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.3 });

const statsSection = document.querySelector('.stats-counter');
if (statsSection) statsObserver.observe(statsSection);

// ===========================
// FAQ Accordion
// ===========================
document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        const isOpen = item.classList.contains('open');
        // Close all
        document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
        // Toggle clicked
        if (!isOpen) item.classList.add('open');
    });
});

// ===========================
// Scroll to Top Button
// ===========================
const scrollToTopBtn = document.getElementById('scrollToTop');
const aboutSection = document.getElementById('about');

window.addEventListener('scroll', () => {
    if (aboutSection) {
        const aboutPosition = aboutSection.offsetTop;
        if (window.pageYOffset >= aboutPosition) {
            scrollToTopBtn.classList.add('show');
        } else {
            scrollToTopBtn.classList.remove('show');
        }
    }
});

scrollToTopBtn.addEventListener('click', () => {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
});

// ===========================
// Image Lightbox for Project Images
// ===========================
const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxClose = document.getElementById('lightboxClose');

// Add click event to all project images (works for both desktop and mobile)
function attachImageClickHandlers() {
    // Only attach on desktop
    if (window.innerWidth > 1024) {
        document.querySelectorAll('.card-image-wrap').forEach(wrap => {
            wrap.style.cursor = 'pointer';
            wrap.addEventListener('click', () => {
                const img = wrap.querySelector('img');
                if (img) {
                    lightboxImage.src = img.src;
                    lightboxImage.alt = img.alt;
                    lightbox.classList.add('active');
                    document.body.style.overflow = 'hidden';
                }
            });
        });
    }
}

// Zoom functionality on lightbox image
lightboxImage.addEventListener('click', (e) => {
    e.stopPropagation();
    lightboxImage.classList.toggle('zoomed');
});

// Touch support for mobile zoom
lightboxImage.addEventListener('touchend', (e) => {
    e.stopPropagation();
    lightboxImage.classList.toggle('zoomed');
});

// Initial attachment
attachImageClickHandlers();

// Close lightbox
function closeLightbox() {
    lightbox.classList.remove('active');
    lightboxImage.classList.remove('zoomed');
    document.body.style.overflow = 'auto';
}

lightboxClose.addEventListener('click', closeLightbox);

// Close on background click
lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) {
        closeLightbox();
    }
});

// Close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightbox.classList.contains('active')) {
        closeLightbox();
    }
});

// ===========================
// Service Detail Modal
// ===========================
const svcIconMap = {
    'interior-design': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
    'architectural-design': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`,
    'engineering-design': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>`,
    'interior-renovation': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    'residential-construction': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    'ground-up-construction': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>`,
    'commercial-renovation': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>`
};

const serviceData = {
    'interior-design': {
        category: 'Design',
        title: 'Interior Design',
        description: 'We craft interior spaces that balance aesthetics with function — transforming bare units into fully personalized living environments. From concept boards to construction-ready design plans, our interior designers handle every detail.',
        features: [
            'Space planning & layout optimization',
            'Material & finish selection',
            'Furniture & lighting design',
            'Concept to turnover coordination'
        ],
        images: [
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (1).png', label: 'Avida Towers Vita — Proposal' },
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (2).png', label: 'Avida Towers Vita — Turnover' },
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (4).png', label: 'Park Triangle Residences — Turnover' },
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (5).png', label: 'San Lorenzo Place — Proposal' },
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (6).png', label: 'San Lorenzo Place — Turnover' }
        ]
    },
    'architectural-design': {
        category: 'Design',
        title: 'Architectural Design',
        description: 'Our architects deliver comprehensive building plans that meet local codes, reflect your design vision, and serve as the precise blueprint for your construction team. We specialize in both residential and commercial projects.',
        features: [
            'Floor plan & elevation design',
            'Permit-ready documentation',
            'Residential & commercial projects',
            '3D architectural visualization'
        ],
        images: [
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (11).png', label: 'Mallari Bldg — Proposal' },
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (13).png', label: 'AUM Bldg — Proposal' }
        ]
    },
    'engineering-design': {
        category: 'Design',
        title: 'Engineering Design',
        description: 'Structural integrity is non-negotiable. Our civil and structural engineers design systems that are safe, efficient, and built to last — coordinating with architects to ensure every design is buildable and code-compliant.',
        features: [
            'Structural analysis & design',
            'Electrical & mechanical systems',
            'Foundation & load calculations',
            'Code compliance & safety checks'
        ],
        images: [
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (12).png', label: 'Mallari Bldg — Construction Phase' },
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (13).png', label: 'AUM Bldg — Engineering Proposal' },
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (14).png', label: 'AUM Bldg (Tom N Toms) — Turnover' }
        ]
    },
    'interior-renovation': {
        category: 'Construction',
        title: 'Interior Renovation',
        description: "We bring new life to existing spaces through precision renovation work. Whether it's a condo unit, clinic, or commercial space, our team handles the full scope — from demolition to finishing — with minimal disruption.",
        features: [
            'Full & partial renovation',
            'Condo & residential units',
            'Commercial space fit-outs',
            'Clean, on-schedule delivery'
        ],
        images: [
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (7).png', label: 'SMDC Grass Residence — Turnover' },
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (8).png', label: 'Renovation Turnover' },
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (9).png', label: 'Health Works — Proposal' },
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (10).png', label: 'Health Works — Turnover' }
        ]
    },
    'residential-construction': {
        category: 'Construction',
        title: 'Residential Construction',
        description: 'From single-family homes to multi-story residential buildings, we manage the full build — from groundbreaking to final handover. We use quality materials, trusted subcontractors, and tight project management to deliver on time.',
        features: [
            'Single & multi-family homes',
            'Foundation to finishing work',
            'Regular progress updates',
            'On-time project delivery'
        ],
        images: [
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (11).png', label: 'Mallari Bldg — Proposal' },
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (12).png', label: 'Mallari Bldg — Turnover' }
        ]
    },
    'ground-up-construction': {
        category: 'Construction',
        title: 'Ground-Up Construction',
        description: 'We handle complete construction from bare land to fully built structure. Our team coordinates every phase — site preparation, structural work, MEP systems, and interior finishing — under one roof for seamless execution.',
        features: [
            'Site preparation & excavation',
            'Structural framing & concrete work',
            'MEP systems installation',
            'Complete interior & exterior finish'
        ],
        images: [
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (12).png', label: 'Mallari Bldg — Construction Phase' },
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (14).png', label: 'Tom N Toms Coffee — Turnover' }
        ]
    },
    'commercial-renovation': {
        category: 'Construction',
        title: 'Commercial Renovation',
        description: 'We specialize in transforming commercial spaces — offices, clinics, retail stores, and multi-use buildings. Our commercial renovation team delivers polished results that reflect your brand and serve your customers.',
        features: [
            'Office & retail fit-outs',
            'Clinic & healthcare spaces',
            'Multi-use building renovation',
            'Brand-aligned design execution'
        ],
        images: [
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (9).png', label: 'Health Works — Proposal' },
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (10).png', label: 'Health Works — Turnover' },
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (13).png', label: 'AUM Bldg — Proposal' },
            { src: 'assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (14).png', label: 'Tom N Toms Coffee — Turnover' }
        ]
    }
};

const svcModalOverlay = document.getElementById('svcModalOverlay');
const svcModalClose  = document.getElementById('svcModalClose');

function openSvcModal(key) {
    const svc = serviceData[key];
    if (!svc) return;

    // Populate info panel
    document.getElementById('svcModalIcon').innerHTML     = svcIconMap[key] || '';
    document.getElementById('svcModalCategory').textContent = svc.category;
    document.getElementById('svcModalTitle').textContent  = svc.title;
    document.getElementById('svcModalDesc').textContent   = svc.description;
    document.getElementById('svcModalFeatures').innerHTML =
        svc.features.map(f => `<li>${f}</li>`).join('');

    // Populate gallery
    const mainImg   = document.getElementById('svcGalleryMain');
    const labelEl   = document.getElementById('svcGalleryLabel');
    const thumbsEl  = document.getElementById('svcGalleryThumbs');

    function setActive(index) {
        mainImg.src       = svc.images[index].src;
        mainImg.alt       = svc.images[index].label;
        labelEl.textContent = svc.images[index].label;
        thumbsEl.querySelectorAll('.svc-thumb').forEach((t, i) => {
            t.classList.toggle('active', i === index);
        });
    }

    thumbsEl.innerHTML = svc.images.map((img, i) =>
        `<button class="svc-thumb${i === 0 ? ' active' : ''}" type="button" aria-label="${img.label}">
            <img src="${img.src}" alt="${img.label}" loading="lazy">
        </button>`
    ).join('');

    thumbsEl.querySelectorAll('.svc-thumb').forEach((thumb, i) => {
        thumb.addEventListener('click', () => setActive(i));
    });

    setActive(0);

    svcModalOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeSvcModal() {
    svcModalOverlay.classList.remove('open');
    document.body.style.overflow = '';
}

// Attach click to each service row
document.querySelectorAll('.svc-item[data-service]').forEach(item => {
    item.addEventListener('click', function(e) {
        e.preventDefault();
        openSvcModal(this.dataset.service);
    });
});

// Close on button, overlay click, or Escape
svcModalClose.addEventListener('click', closeSvcModal);
svcModalOverlay.addEventListener('click', e => {
    if (e.target === svcModalOverlay) closeSvcModal();
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && svcModalOverlay.classList.contains('open')) closeSvcModal();
});