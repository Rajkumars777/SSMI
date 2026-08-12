'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Navbar.module.css';

const navLinks = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/meeting/new', label: 'New Meeting' },
  { href: '/search', label: 'Search' },
  { href: '/settings', label: 'Settings' },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <Link href="/" className={styles.logo}>
          <span className={styles.logoIcon}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="10" stroke="url(#grad)" strokeWidth="1.5" />
              <path d="M6 11 Q8.5 7 11 11 Q13.5 15 16 11" stroke="url(#grad)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#4f8ef7" />
                  <stop offset="100%" stopColor="#7c5df0" />
                </linearGradient>
              </defs>
            </svg>
          </span>
          <span className={styles.logoText}>SSMI</span>
          <span className={styles.brandBadge}>PRO AI</span>
        </Link>


        <div className={styles.links}>
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`${styles.link} ${pathname?.startsWith(link.href) ? styles.active : ''}`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className={styles.actions}>
          <Link href="/meeting/new" className="btn btn-primary btn-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="6" fill="currentColor" opacity="0.3" />
              <circle cx="12" cy="12" r="3" fill="currentColor" />
            </svg>
            Start Meeting
          </Link>
          <div className={styles.avatar} title="Sales Professional">SP</div>
        </div>
      </div>
    </nav>
  );
}
