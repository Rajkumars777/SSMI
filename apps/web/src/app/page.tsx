import Link from 'next/link';
import styles from './page.module.css';

const features = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="6" fill="currentColor" opacity="0.2" />
        <circle cx="12" cy="12" r="3" fill="currentColor" />
        <circle cx="12" cy="12" r="10" strokeDasharray="2 2" />
      </svg>
    ),
    title: 'One-Touch Recording',
    desc: 'Start capturing your meeting with a single tap. AI begins analysis instantly.',
    color: '#4f8ef7',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 2a10 10 0 0 0 0 20 10 10 0 0 0 0-20z" opacity="0.2" fill="currentColor" />
        <path d="M12 6v6l4 2" /><circle cx="12" cy="12" r="10" />
      </svg>
    ),
    title: 'AI Timeline Generation',
    desc: 'Jump directly to pricing discussions, objections, decisions & commitments.',
    color: '#7c5df0',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="currentColor" opacity="0.2" />
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: 'Smart Summaries',
    desc: 'Evidence-backed summaries with decisions, risks, and next steps extracted automatically.',
    color: '#22d3a0',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 1v22M4.22 4.22l15.56 15.56M1 12h22M4.22 19.78L19.78 4.22" opacity="0.3" />
        <circle cx="12" cy="12" r="5" fill="currentColor" opacity="0.2" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
      </svg>
    ),
    title: 'Voice Gesture Bookmarks',
    desc: 'Whistle to bookmark key moments — hands-free, while staying fully engaged in conversation.',
    color: '#f59e0b',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    title: 'Action Item Extraction',
    desc: 'Every commitment, follow-up, and deadline automatically captured with evidence.',
    color: '#4f8ef7',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="11" cy="11" r="8" fill="currentColor" opacity="0.2" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
    title: 'Semantic Search',
    desc: 'Find any meeting, topic, or decision across your entire meeting history instantly.',
    color: '#22d3ee',
  },
];

const steps = [
  { num: '01', title: 'Start Meeting', desc: 'Tap Start. SSMI begins recording and AI analysis.' },
  { num: '02', title: 'Conduct Meeting', desc: 'Focus on your customer. Whistle to bookmark key moments.' },
  { num: '03', title: 'AI Processing', desc: 'Transcript, speaker diarization, event detection — fully automated.' },
  { num: '04', title: 'Review Intelligence', desc: 'Jump to any moment. Review summaries, timelines & actions.' },
];

const stats = [
  { value: '94%', label: 'AI Accuracy' },
  { value: '8x', label: 'Faster Review' },
  { value: '₹0', label: 'API Cost' },
  { value: '100%', label: 'Private & Local' },
];

export default function HomePage() {
  return (
    <div className={styles.root}>
      {/* Hero */}
      <section className={styles.hero}>
        <div className="container">
          <div className={styles.heroBadge}>
            <span className="badge badge-blue">AI-Powered Meeting Intelligence</span>
          </div>
          <h1 className={`${styles.heroTitle} fade-in-up fade-in-up-1`}>
            Never miss a{' '}
            <span className="gradient-text">critical moment</span>{' '}
            in your sales meetings
          </h1>
          <p className={`${styles.heroSubtitle} fade-in-up fade-in-up-2`}>
            SSMI automatically records, transcribes, and analyses your customer meetings —
            detecting pricing discussions, objections, decisions, and action items with
            evidence-backed AI intelligence.
          </p>
          <div className={`${styles.heroCta} fade-in-up fade-in-up-3`}>
            <Link href="/meeting/new" className="btn btn-primary btn-xl">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="6" fill="currentColor" opacity="0.3" />
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
              Start a Meeting
            </Link>
            <Link href="/dashboard" className="btn btn-secondary btn-xl">
              View Dashboard
            </Link>
          </div>

          {/* Live waveform visual */}
          <div className={`${styles.waveViz} fade-in-up fade-in-up-4`}>
            <div className={styles.waveCard}>
              <div className={styles.waveTop}>
                <div className={styles.recDot} />
                <span className={styles.recLabel}>LIVE RECORDING</span>
                <span className={styles.recTimer}>12:34</span>
              </div>
              <div className={styles.waveBars}>
                {Array.from({ length: 40 }).map((_, i) => (
                  <span
                    key={i}
                    className={styles.waveBar}
                    style={{
                      animationDelay: `${(i * 60) % 700}ms`,
                      animationDuration: `${600 + (i * 83) % 500}ms`,
                      height: `${20 + Math.sin(i * 0.6) * 40 + 20}%`,
                    }}
                  />
                ))}
              </div>
              <div className={styles.eventPills}>
                <span className={`badge badge-red ${styles.pill}`}>Pricing Objection · 08:32</span>
                <span className={`badge badge-green ${styles.pill}`}>Decision · 11:14</span>
                <span className={`badge badge-amber ${styles.pill}`}>Budget · 05:47</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className={`${styles.statsSection} section`}>
        <div className="container">
          <div className={styles.statsGrid}>
            {stats.map((s) => (
              <div key={s.label} className={`glass-card ${styles.statCard}`}>
                <span className={styles.statValue}>{s.value}</span>
                <span className={styles.statLabel}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className={`${styles.featuresSection} section`}>
        <div className="container">
          <div className={styles.sectionHeader}>
            <h2>Everything your sales team needs</h2>
            <p>AI capabilities that turn every meeting into structured, searchable intelligence</p>
          </div>
          <div className={styles.featuresGrid}>
            {features.map((f) => (
              <div
                key={f.title}
                className={`glass-card ${styles.featureCard}`}
                style={{ '--feature-color': f.color } as React.CSSProperties}
              >
                <div className={styles.featureIcon} style={{ color: f.color }}>
                  {f.icon}
                </div>
                <h4 className={styles.featureTitle}>{f.title}</h4>
                <p className={styles.featureDesc}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className={`${styles.howSection} section`}>
        <div className="container">
          <div className={styles.sectionHeader}>
            <h2>How SSMI works</h2>
            <p>Four simple steps from meeting start to actionable intelligence</p>
          </div>
          <div className={styles.stepsGrid}>
            {steps.map((s, i) => (
              <div key={s.num} className={`glass-card ${styles.step}`}>
                <span className={styles.stepNum}>{s.num}</span>
                <h4 className={styles.stepTitle}>{s.title}</h4>
                <p className={styles.stepDesc}>{s.desc}</p>
                {i < steps.length - 1 && (
                  <div className={styles.stepArrow}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className={`${styles.ctaSection} section`}>
        <div className="container">
          <div className={`glass-card ${styles.ctaCard}`}>
            <h2>Ready to transform your sales meetings?</h2>
            <p>Join sales teams who never miss a critical customer insight again.</p>
            <div className={styles.ctaBtns}>
              <Link href="/meeting/new" className="btn btn-primary btn-xl">
                Start Your First Meeting
              </Link>
              <Link href="/dashboard" className="btn btn-secondary btn-lg">
                View Demo Data
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className="container">
          <div className={styles.footerInner}>
            <span className="gradient-text" style={{ fontWeight: 700 }}>SSMI</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              Smart Sales Meeting Intelligence · ₹0 API cost · Privacy-first
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
