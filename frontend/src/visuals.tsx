import { useId } from 'react';

/** Original vector artwork; no remote media or third-party branded assets. */
export function OrbitVisual({ compact = false }: { compact?: boolean }) {
  const id = useId().replace(/:/g, '');
  const dots: { x: number; y: number; r: number; opacity: number }[] = [];
  for (let latitude = -82; latitude <= 82; latitude += 4.5) {
    const lat = latitude * Math.PI / 180;
    for (let longitude = -86; longitude <= 86; longitude += 4.5) {
      const lon = longitude * Math.PI / 180;
      const z = Math.cos(lat) * Math.cos(lon);
      const land = Math.sin(lon * 3.5 + lat * 1.8) + Math.cos(lat * 4.3 - lon) > .22;
      dots.push({ x: 329 + 184 * Math.cos(lat) * Math.sin(lon), y: 214 - 184 * Math.sin(lat), r: land ? 1.3 : .55, opacity: (land ? .75 : .19) * (.2 + .8 * z) });
    }
  }
  return <svg className={`orbit-visual${compact ? ' compact' : ''}`} viewBox="0 0 620 400" role="img" aria-label="紫色点阵星球品牌插画">
    <defs>
      <radialGradient id={`${id}-sphere`} cx="38%" cy="28%" r="75%"><stop offset="0" stopColor="#402077" stopOpacity=".4"/><stop offset=".65" stopColor="#130c27" stopOpacity=".6"/><stop offset="1" stopColor="#7336c6" stopOpacity=".45"/></radialGradient>
      <radialGradient id={`${id}-halo`}><stop offset=".54" stopColor="#8847e8" stopOpacity="0"/><stop offset=".68" stopColor="#6e38cb" stopOpacity=".18"/><stop offset=".72" stopColor="#a66bff" stopOpacity=".18"/><stop offset="1" stopColor="#7134be" stopOpacity="0"/></radialGradient>
      <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d1aaff"/><stop offset=".42" stopColor="#a26bf0" stopOpacity=".65"/><stop offset=".8" stopColor="#44247e" stopOpacity=".25"/><stop offset="1" stopColor="#a683ed" stopOpacity=".7"/></linearGradient>
      <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>
      <linearGradient id={`${id}-orbit`}><stop stopColor="#ad83ec" stopOpacity="0"/><stop offset=".5" stopColor="#bb91ff" stopOpacity=".7"/><stop offset="1" stopColor="#9e70ec" stopOpacity=".1"/></linearGradient>
    </defs>
    <circle cx="329" cy="214" r="255" fill={`url(#${id}-halo)`}/>
    <circle cx="329" cy="214" r="185" fill="none" stroke="#9256ec" strokeWidth="8" opacity=".35" filter={`url(#${id}-blur)`}/>
    <circle cx="329" cy="214" r="185" fill={`url(#${id}-sphere)`} stroke={`url(#${id}-rim)`} strokeWidth="1.8"/>
    <g fill="#be94ff">{dots.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={p.r} opacity={p.opacity}/>)}</g>
    <ellipse cx="329" cy="214" rx="258" ry="71" transform="rotate(-26 329 214)" fill="none" stroke={`url(#${id}-orbit)`} strokeWidth="1"/>
    <ellipse cx="329" cy="214" rx="236" ry="85" transform="rotate(24 329 214)" fill="none" stroke="#9272ca" strokeWidth=".65" opacity=".22"/>
    <g fill="#cbb4f6"><circle cx="110" cy="309" r="3"/><circle cx="528" cy="98" r="2.5"/><circle cx="152" cy="80" r="1.3" opacity=".6"/><circle cx="539" cy="284" r="1.8" opacity=".65"/><circle cx="85" cy="163" r="1" opacity=".5"/><circle cx="480" cy="31" r="1" opacity=".5"/></g>
    <g fill="none" stroke="#b991ff" opacity=".6"><circle cx="528" cy="98" r="8"/><circle cx="110" cy="309" r="8"/></g>
    <g transform="translate(447 237)"><rect width="124" height="52" rx="10" fill="#151020" fillOpacity=".9" stroke="#7753a3" strokeOpacity=".45"/><circle cx="20" cy="26" r="10" fill="#9a69ea" fillOpacity=".2"/><path d="m15 27 4 4 7-10" fill="none" stroke="#c2a2fc" strokeWidth="1.7"/><text x="38" y="23" fill="#b7acc8" fontSize="10" fontFamily="system-ui">WORKFLOW</text><text x="38" y="38" fill="#e8def9" fontSize="11" fontFamily="system-ui">Connected.</text></g>
  </svg>;
}

export function ProductVisual({ variant = 'cream', className = '' }: { variant?: 'cream' | 'purple'; className?: string }) {
  const id = useId().replace(/:/g, '');
  const purple = variant === 'purple';
  return <svg className={`product-visual ${className}`} viewBox="0 0 420 480" role="img" aria-label="奶油白随行保温杯示意插画，非实拍">
    <defs>
      <linearGradient id={`${id}-body`} x1="0" x2="1"><stop stopColor="#b7b0a1"/><stop offset=".17" stopColor="#e9e2d1"/><stop offset=".42" stopColor="#f9f3e6"/><stop offset=".72" stopColor="#e9e2d1"/><stop offset="1" stopColor="#b2ad9e"/></linearGradient>
      <linearGradient id={`${id}-lid`} x1="0" x2="1"><stop stopColor="#a59f8f"/><stop offset=".25" stopColor="#e2dccc"/><stop offset=".65" stopColor="#ede7d8"/><stop offset="1" stopColor="#b4ae9f"/></linearGradient>
      <linearGradient id={`${id}-floor`} x1="0" y1="0" x2="0" y2="1"><stop stopColor={purple ? '#282033' : '#dcded0'}/><stop offset="1" stopColor={purple ? '#17131f' : '#bec4b0'}/></linearGradient>
      <radialGradient id={`${id}-light`}><stop stopColor={purple ? '#754a9d' : '#f5f5e7'} stopOpacity=".7"/><stop offset="1" stopColor={purple ? '#2b1f3c' : '#d9dfcb'} stopOpacity="0"/></radialGradient>
      <filter id={`${id}-shadow`} x="-60%" y="-80%" width="220%" height="260%"><feGaussianBlur stdDeviation="9"/></filter>
      <linearGradient id={`${id}-shine`} x1="0" x2="1"><stop stopColor="white" stopOpacity="0"/><stop offset=".5" stopColor="white" stopOpacity=".5"/><stop offset="1" stopColor="white" stopOpacity="0"/></linearGradient>
    </defs>
    <rect width="420" height="480" fill={`url(#${id}-floor)`}/>
    <circle cx="300" cy="130" r="240" fill={`url(#${id}-light)`}/>
    <path d="M0 352 420 306V480H0Z" fill={purple ? '#281d33' : '#c6cdb9'}/>
    <ellipse cx="219" cy="414" rx="96" ry="18" fill="#1b2218" opacity=".19" filter={`url(#${id}-shadow)`}/>
    <g transform="rotate(-8 210 260)">
      <path d="M158 134H263L267 376Q267 411 210 414Q152 411 152 377Z" fill={`url(#${id}-body)`} stroke="#a39d8f" strokeWidth=".7"/>
      <ellipse cx="210.5" cy="136" rx="52.5" ry="12" fill="#c9c3b4"/>
      <path d="M157 110Q157 100 170 98L250 98Q264 100 264 110V137Q260 151 210 152Q161 150 157 137Z" fill={`url(#${id}-lid)`}/>
      <ellipse cx="210.5" cy="109" rx="53.5" ry="13" fill="#e8e2d3"/>
      <ellipse cx="210.5" cy="107" rx="45" ry="8.7" fill="#c5beaf"/>
      <path d="M183 102V81Q184 60 210 61Q236 60 238 81V102" fill="none" stroke="#d4cebf" strokeWidth="10"/>
      <path d="M184 99V82Q185 64 209 64Q231 64 234 82V100" fill="none" stroke="#f4eee1" strokeWidth="2" opacity=".75"/>
      <path d="M158 140Q208 156 264 140" fill="none" stroke="#817d72" strokeWidth="2.3" opacity=".7"/>
      <path d="M168 172Q164 260 165 371Q165 391 182 397" fill="none" stroke="#fff8e9" strokeWidth="2" opacity=".65"/>
      <rect x="183" y="170" width="19" height="206" rx="9" fill={`url(#${id}-shine)`} opacity=".32"/>
      <g fill="#777c6d" textAnchor="middle" fontFamily="Georgia, serif"><text x="211" y="290" fontSize="18" letterSpacing="3">QINGHE</text><text x="211" y="309" fontSize="8" letterSpacing="3">EVERYDAY, SLOWLY.</text></g>
      <path d="M201 259q10-22 20-8q-9 11-20 8m10 0v13" fill="none" stroke="#7e8974" strokeWidth="1.5"/>
      <path d="M157 390Q209 413 263 390" fill="none" stroke="#999585" strokeWidth="1" opacity=".65"/>
    </g>
    <g fill={purple ? '#c0adc9' : '#6c765d'} fontFamily="system-ui" opacity=".75"><text x="28" y="37" fontSize="10" letterSpacing="2">QINGHE / DAILY OBJECTS</text><text x="28" y="453" fontSize="9" letterSpacing="2">500 ML · CREAM WHITE</text></g>
  </svg>;
}

export function MiniChart({ values = [12, 18, 14, 25, 21, 31, 28, 36, 32, 44, 42, 56], color = '#a78bfa' }: { values?: number[]; color?: string }) {
  const id = useId().replace(/:/g, '');
  const safe = values.length > 1 ? values : [0, ...values];
  const min = Math.min(...safe), max = Math.max(...safe), range = max - min || 1;
  const points = safe.map((v, i) => ({ x: i * 300 / (safe.length - 1), y: 62 - (v - min) * 48 / range }));
  let path = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) { const p = points[i - 1], c = points[i], mid = (p.x + c.x) / 2; path += ` C${mid} ${p.y},${mid} ${c.y},${c.x} ${c.y}`; }
  return <svg className="mini-chart" viewBox="0 0 300 78" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor={color} stopOpacity=".21"/><stop offset="1" stopColor={color} stopOpacity="0"/></linearGradient></defs><path d={`${path} L300 78 L0 78Z`} fill={`url(#${id})`}/><path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg>;
}
