// ── Copy to Clipboard ──────────────────────────────────────────────────────

window.copyToClipboard = async function(text) {
  try {
    await navigator.clipboard.writeText(text.trim());
    // Show feedback
    const allCommands = document.querySelectorAll('.install-command');
    allCommands.forEach(cmd => {
      const originalText = cmd.textContent;
      cmd.textContent = '✓ Copied!';
      cmd.style.color = 'var(--brand-accent)';
      setTimeout(() => {
        cmd.textContent = originalText;
        cmd.style.color = '';
      }, 2000);
    });
  } catch (error) {
    console.error('Failed to copy:', error);
    alert('Please copy manually: ' + text);
  }
};

// ── Smooth Scroll ──────────────────────────────────────────────────────────

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const href = this.getAttribute('href');
    if (href === '#') return;

    e.preventDefault();
    const target = document.querySelector(href);
    if (target) {
      const offsetTop = target.offsetTop - 80; // Account for fixed nav
      window.scrollTo({
        top: offsetTop,
        behavior: 'smooth'
      });
    }
  });
});

// ── Intersection Observer for Fade-in Animations ───────────────────────────

const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('fade-in-up');
      observer.unobserve(entry.target);
    }
  });
}, observerOptions);

document.querySelectorAll('.card, .section-header, .architecture-diagram, .stat-card').forEach(el => {
  observer.observe(el);
});

// ── Nav Background on Scroll ───────────────────────────────────────────────

let lastScroll = 0;
const nav = document.querySelector('nav');

window.addEventListener('scroll', () => {
  const currentScroll = window.pageYOffset;

  if (currentScroll > 100) {
    nav.style.background = 'rgba(10, 14, 20, 0.95)';
    nav.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.3)';
  } else {
    nav.style.background = 'rgba(10, 14, 20, 0.9)';
    nav.style.boxShadow = 'none';
  }

  lastScroll = currentScroll;
});

// ── Initialize ─────────────────────────────────────────────────────────────

// No initialization needed for now
