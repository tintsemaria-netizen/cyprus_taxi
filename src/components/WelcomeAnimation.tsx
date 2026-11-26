'use client';

// Start-page animation (2026-11-26, operator «а можешь анимацию сделать?»): our pin drops onto a small city map,
// the route draws from the pickup to the flag, and a car drives it — again and again. Pure SVG + CSS, no
// libraries; people who asked their phone for less motion get the still picture.
import { LogoMark } from '@/components/Brand';

const ROUTE = 'M 40 132 C 90 132 92 82 140 82 S 196 40 262 38';

export function WelcomeAnimation() {
  return (
    <div className="ily-anim relative mx-auto w-full max-w-sm" aria-hidden data-testid="welcome-anim">
      <style>{`
        .ily-anim .drop { animation: ily-drop .9s cubic-bezier(.3,1.6,.5,1) both; }
        .ily-anim .route { stroke-dasharray: 340; stroke-dashoffset: 340; animation: ily-draw 6s ease-in-out infinite; }
        .ily-anim .pulse { transform-origin: 40px 132px; animation: ily-pulse 2s ease-out infinite; }
        .ily-anim .flag { transform-origin: 262px 38px; animation: ily-flag 6s ease-in-out infinite; }
        .ily-anim .car { offset-path: path('${ROUTE}'); offset-rotate: auto; animation: ily-drive 6s ease-in-out infinite; }
        @keyframes ily-drop { 0% { transform: translateY(-40px); opacity: 0 } 60% { opacity: 1 } 100% { transform: none; opacity: 1 } }
        @keyframes ily-draw { 0%, 8% { stroke-dashoffset: 340 } 55%, 85% { stroke-dashoffset: 0 } 100% { stroke-dashoffset: 0; opacity: 0 } }
        @keyframes ily-pulse { 0% { transform: scale(.6); opacity: .9 } 100% { transform: scale(2.4); opacity: 0 } }
        @keyframes ily-flag { 0%, 50% { transform: scale(0) } 60% { transform: scale(1.25) } 66%, 92% { transform: scale(1) } 100% { transform: scale(0) } }
        @keyframes ily-drive { 0%, 12% { offset-distance: 0%; opacity: 0 } 16% { opacity: 1 } 60%, 86% { offset-distance: 100%; opacity: 1 } 96%, 100% { offset-distance: 100%; opacity: 0 } }
        .ily-t1 { animation: ily-t1 6s ease-in-out infinite; }
        .ily-t2 { animation: ily-t2 6s ease-in-out infinite; }
        @keyframes ily-t1 { 0%, 58% { opacity: 1; transform: none } 64%, 92% { opacity: 0; transform: translateY(-10px) } 100% { opacity: 1; transform: none } }
        @keyframes ily-t2 { 0%, 60% { opacity: 0; transform: translateY(10px) } 66%, 90% { opacity: 1; transform: none } 96%, 100% { opacity: 0; transform: translateY(-10px) } }
        .ily-in { animation: ily-in .6s ease-out both; }
        @keyframes ily-in { from { transform: translateY(14px); opacity: 0 } to { transform: none; opacity: 1 } }
        @media (prefers-reduced-motion: reduce) {
          .ily-anim .drop, .ily-anim .pulse, .ily-in, .ily-t1 { animation: none }
          .ily-t2 { animation: none; opacity: 0 }
          .ily-anim .route { animation: none; stroke-dashoffset: 0 }
          .ily-anim .flag { animation: none; transform: none }
          .ily-anim .car { animation: none; offset-distance: 100% }
        }
      `}</style>
      <svg viewBox="0 0 300 170" className="w-full">
        {/* streets */}
        <defs>
          <radialGradient id="ily-fade" cx="50%" cy="50%" r="60%"><stop offset="55%" stopColor="#fff" /><stop offset="100%" stopColor="#fff" stopOpacity="0" /></radialGradient>
          <mask id="ily-mask"><rect width="300" height="170" fill="url(#ily-fade)" /></mask>
        </defs>
        <g className="text-edge-strong" stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none" opacity=".35" mask="url(#ily-mask)">
          <path d="M 0 132 H 300" /><path d="M 0 82 H 300" /><path d="M 20 38 H 300" />
          <path d="M 60 0 V 170" /><path d="M 140 0 V 170" /><path d="M 222 0 V 170" />
        </g>
        {/* route */}
        <path className="route text-accent" d={ROUTE} stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" />
        {/* pickup */}
        <circle className="pulse text-accent" cx="40" cy="132" r="9" fill="currentColor" opacity=".5" />
        <circle className="text-accent" cx="40" cy="132" r="6" fill="currentColor" />
        {/* drop-off flag */}
        <g className="flag">
          <circle cx="262" cy="38" r="7" fill="#fff" />
          <circle cx="262" cy="38" r="3" fill="#10191C" />
          <path d="M 262 38 V 14" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <path d="M 263 14 h 14 l -4 5 l 4 5 h -14 z" className="text-accent" fill="currentColor" />
        </g>
        {/* car */}
        <g className="car">
          <rect x="-11" y="-6.5" width="22" height="13" rx="4" className="text-accent" fill="currentColor" />
          <rect x="2" y="-4.5" width="6" height="9" rx="1.5" fill="#10191C" opacity=".75" />
          <circle cx="11" cy="-4" r="1.6" fill="#fff" /><circle cx="11" cy="4" r="1.6" fill="#fff" />
        </g>
      </svg>
      {/* our pin drops in on the pickup */}
      <div className="drop absolute" style={{ left: `${(40 / 300) * 100}%`, top: `${(132 / 170) * 100}%` }}>
        <div style={{ transform: 'translate(-50%, -100%)' }}><LogoMark className="h-12 w-12 drop-shadow-lg" /></div>
      </div>
    </div>
  );
}
