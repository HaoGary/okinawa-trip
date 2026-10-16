/* ==========================================================================
   lib/scenes.js — 地點景色插圖（SVG，120×120）

   每個地點在資料中以 scene 指定插圖種類：
     airport  機場          city     城市街景      street   單軌電車下的商店街
     aquarium 水族館        mall     購物中心      bridge   跨海大橋
     castle   紅色城郭      museum   現代建築      shrine   海邊懸崖神社
     cave     鐘乳石洞      harbor   漁港與市場    terrace  海邊白色露台
   想改用實景照片：在地點資料加 photo: 'images/xxx.jpg'，popup 會優先顯示照片。
   ========================================================================== */
(function (Trip) {
  'use strict';

  let uid = 0;   // 每張插圖的漸層 id 需唯一

  function render(type) {
    const id='sc'+(++uid);
    const sky=`<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f86d6"/><stop offset="1" stop-color="#bfe3fb"/></linearGradient><linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2bb3c9"/><stop offset="1" stop-color="#0d6f9e"/></linearGradient></defs><rect width="120" height="120" fill="url(#${id}s)"/>`;
    const cloud=(x,y,s=1)=>`<g fill="#fff" opacity=".9" transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="10" ry="5"/><ellipse cx="8" cy="-3" rx="8" ry="6"/><ellipse cx="15" cy="0" rx="8" ry="4.5"/></g>`;
    const sea=y=>`<rect y="${y}" width="120" height="${120-y}" fill="url(#${id}w)"/><path d="M0 ${y+6} q10 -3 20 0 t20 0 t20 0 t20 0 t20 0 t20 0" stroke="#bff0f5" stroke-width="1.2" fill="none" opacity=".7"/>`;
    const palm=(x,y,h=26)=>`<g><path d="M${x} ${y} q2 -${h/2} 0 -${h}" stroke="#7a5a3a" stroke-width="2.4" fill="none"/><g fill="#2e8b4e" transform="translate(${x} ${y-h})"><path d="M0 0 q-10 -2 -15 6 q8 -3 15 -6z"/><path d="M0 0 q10 -2 15 6 q-8 -3 -15 -6z"/><path d="M0 0 q-4 -9 -12 -10 q7 3 12 10z"/><path d="M0 0 q4 -9 12 -10 q-7 3 -12 10z"/></g></g>`;
    const win=(x,y,w,h,c='#9cc9e8')=>{let o='';for(let yy=y;yy<y+h-3;yy+=6)for(let xx=x;xx<x+w-3;xx+=6)o+=`<rect x="${xx}" y="${yy}" width="3.4" height="3.4" fill="${c}"/>`;return o;};
    let body='';
    switch(type){
      case 'airport': body=cloud(20,24)+cloud(80,16,.8)+
        `<g fill="#fff" transform="translate(70 34) rotate(-12)"><path d="M0 0 h34 q6 0 6 3 q0 3 -6 3 h-34z"/><path d="M14 3 l-8 14 h5 l12 -14z"/><path d="M14 3 l-6 -10 h4 l10 10z"/><path d="M1 3 l-4 -7 h3 l5 7z"/></g>`+
        `<rect y="86" width="120" height="34" fill="#cfc9bb"/><path d="M0 120 L46 92 L74 92 L120 120Z" fill="#5f6469"/><path d="M60 94 v26" stroke="#fff" stroke-width="1.5" stroke-dasharray="4 4"/>`+
        `<rect x="6" y="64" width="72" height="24" fill="#e8edf1"/><rect x="6" y="70" width="72" height="9" fill="#6fa8cf"/><path d="M4 64 q38 -10 76 0z" fill="#d6dde3"/><rect x="88" y="50" width="6" height="38" fill="#e8edf1"/><rect x="85" y="44" width="12" height="8" rx="2" fill="#6fa8cf"/>`; break;
      case 'city': body=cloud(18,20)+cloud(78,28,.7)+
        `<rect x="6" y="40" width="26" height="62" fill="#f2efe8"/>${win(9,44,22,52)}<rect x="34" y="56" width="22" height="46" fill="#d9e4ea"/>${win(37,60,18,40,'#6f9fbf')}<rect x="58" y="30" width="28" height="72" fill="#ece6da"/>${win(61,34,24,62,'#8fbbd8')}<rect x="88" y="50" width="26" height="52" fill="#f6f3ee"/>${win(91,54,22,44)}`+
        `<rect y="100" width="120" height="20" fill="#7d8186"/><path d="M0 110 h120" stroke="#f3d36b" stroke-width="1.4" stroke-dasharray="6 5"/>`+palm(30,104,24)+palm(96,104,22); break;
      case 'street': body=cloud(80,18,.8)+
        `<rect x="0" y="36" width="120" height="7" fill="#d9dde0"/><rect x="18" y="43" width="5" height="40" fill="#cfd4d8"/><rect x="88" y="43" width="5" height="40" fill="#cfd4d8"/><rect x="34" y="27" width="46" height="10" rx="4" fill="#f4f6f7"/><rect x="38" y="29" width="38" height="4" fill="#3c8f6e"/>`+
        `<rect x="0" y="62" width="40" height="40" fill="#f1e6d4"/><rect x="0" y="74" width="40" height="7" fill="#c8553d"/><rect x="42" y="56" width="36" height="46" fill="#e9eef0"/><rect x="42" y="72" width="36" height="7" fill="#2f7fb0"/><rect x="80" y="64" width="40" height="38" fill="#f5efe2"/><rect x="80" y="76" width="40" height="7" fill="#e0a43a"/>`+
        `<rect y="100" width="120" height="20" fill="#8a8e92"/>`; break;
      case 'aquarium': body=cloud(22,18)+
        `<path d="M10 66 q50 -34 100 0 v8 h-100z" fill="#e9f1f4"/><path d="M10 66 q50 -34 100 0" stroke="#9ab9c6" stroke-width="2" fill="none"/><rect x="18" y="66" width="84" height="8" fill="#cfdfe6"/>`+sea(74)+
        `<g transform="translate(60 98)"><path d="M-30 0 q14 -9 40 -4 q10 2 18 -6 l-2 10 l4 8 q-10 -6 -20 -3 q-24 6 -40 -5z" fill="#123a5a"/><g fill="#d8f0ff" opacity=".9"><circle cx="-18" cy="-1" r="1"/><circle cx="-10" cy="-3" r="1"/><circle cx="-3" cy="-2" r="1"/><circle cx="4" cy="-3" r="1"/><circle cx="-14" cy="2" r="1"/><circle cx="-6" cy="1" r="1"/></g></g>`; break;
      case 'mall': body=cloud(20,22)+cloud(85,30,.7)+
        `<rect y="88" width="120" height="32" fill="#a9adb0"/><path d="M10 100 h100 M10 110 h100" stroke="#e8e8e8" stroke-width="1"/>`+
        `<rect x="8" y="52" width="104" height="38" fill="#f7f7f5"/><rect x="8" y="52" width="104" height="8" fill="#2a9d8f"/><rect x="44" y="68" width="32" height="22" fill="#7fb6d6"/><path d="M60 68 v22" stroke="#fff" stroke-width="1"/>`+palm(14,94,30)+palm(106,94,28); break;
      case 'bridge': body=cloud(24,20)+cloud(90,14,.7)+sea(62)+
        `<path d="M78 66 q14 -18 42 -10 v12 z" fill="#3f8f4f"/><path d="M78 66 h42 v4 h-42z" fill="#e9dcc0"/>`+
        `<path d="M-2 84 L82 64" stroke="#f4f4f2" stroke-width="3.2"/>${[8,20,32,44,56,68].map(x=>`<rect x="${x}" y="${84-(x+2)*20/84}" width="2" height="${8+ (82-x)/10}" fill="#d8dcdf"/>`).join('')}`+
        `<path d="M0 100 q60 -6 120 0 v20 h-120z" fill="#f1e3c4"/>`; break;
      case 'castle': body=cloud(18,18)+cloud(86,24,.7)+
        `<rect y="92" width="120" height="28" fill="#d8ccb0"/>${[0,1,2,3,4,5,6].map(i=>`<path d="M${i*18} 92 h18 M${i*18+9} 99 v-7 M0 99 h120 M${i*18} 106 v-7 M0 106 h120" stroke="#bfb08f" stroke-width=".8"/>`).join('')}`+
        `<rect x="22" y="62" width="76" height="30" fill="#b3261e"/><path d="M14 63 L60 44 L106 63 Z" fill="#7d1e17"/><path d="M28 52 L60 38 L92 52" stroke="#7d1e17" stroke-width="5" fill="none"/><path d="M14 63 h92" stroke="#e9c46a" stroke-width="1.5"/>`+
        `${[30,42,54,66,78].map(x=>`<rect x="${x}" y="70" width="8" height="22" fill="#8f1d16"/>`).join('')}<rect x="54" y="72" width="12" height="20" fill="#e9c46a" opacity=".85"/><path d="M48 92 h24 l6 8 h-36z" fill="#cdbf9f"/>`; break;
      case 'museum': body=cloud(24,22)+cloud(88,16,.7)+
        `<rect y="94" width="120" height="26" fill="#6fae5b"/><path d="M14 94 L20 50 H100 L106 94Z" fill="#f4f2ec"/><path d="M20 50 H100" stroke="#d9d4c7" stroke-width="2"/>${[30,40,50,60,70,80,90].map(x=>`<rect x="${x}" y="58" width="3" height="30" fill="#c9c2b2"/>`).join('')}<rect x="50" y="76" width="20" height="18" fill="#6f97b3"/>`; break;
      case 'shrine': body=cloud(26,20)+sea(70)+
        `<path d="M60 120 V72 q8 -14 30 -16 q22 0 30 6 V120z" fill="#a8977c"/><path d="M66 120 V80 q10 -10 28 -14" stroke="#8c7c63" stroke-width="2" fill="none"/>`+
        `<rect x="80" y="42" width="26" height="14" fill="#f3efe6"/><path d="M74 44 L93 32 L112 44Z" fill="#b8322a"/><path d="M76 44 h34" stroke="#7d1e17" stroke-width="2"/>`+
        `<path d="M0 104 q30 -6 60 2 v14 h-60z" fill="#f3e6c8"/>`; break;
      case 'cave': body=`<rect width="120" height="120" fill="#2a1f1a"/><radialGradient id="${id}g" cx=".5" cy=".55" r=".55"><stop offset="0" stop-color="#f2b866"/><stop offset=".6" stop-color="#8a5a33"/><stop offset="1" stop-color="#2a1f1a"/></radialGradient><rect width="120" height="120" fill="url(#${id}g)"/>`+
        `<path d="M0 0 h120 v18 ${Array.from({length:12},(_,i)=>`l-5 ${i%2?14:26} l-5 -${i%2?14:26}`).join(' ')} z" fill="#3b2a20"/>`+
        `<path d="M0 120 v-14 ${Array.from({length:12},(_,i)=>`l5 -${i%3?8:16} l5 ${i%3?8:16}`).join(' ')} V120z" fill="#3b2a20"/><ellipse cx="60" cy="98" rx="34" ry="5" fill="#7fc6d1" opacity=".55"/>`; break;
      case 'harbor': body=cloud(22,18)+cloud(88,24,.7)+sea(84)+
        `<rect x="6" y="56" width="70" height="30" fill="#f2f2ef"/><path d="M2 58 L41 44 L80 58Z" fill="#2f6fa8"/><rect x="26" y="62" width="30" height="8" fill="#2f6fa8"/><rect x="14" y="74" width="12" height="12" fill="#6f8fa6"/><rect x="56" y="74" width="12" height="12" fill="#6f8fa6"/>`+
        `<rect x="0" y="84" width="120" height="4" fill="#bdbab2"/><g transform="translate(86 92)"><path d="M0 0 h26 l-4 8 h-18z" fill="#fff"/><rect x="8" y="-8" width="9" height="8" fill="#e8eef2"/><path d="M14 -8 v-10" stroke="#555" stroke-width="1"/></g>`; break;
      case 'terrace': body=cloud(20,16)+
        `<g fill="#fff" transform="translate(62 18) rotate(-14) scale(.7)"><path d="M0 0 h34 q6 0 6 3 q0 3 -6 3 h-34z"/><path d="M14 3 l-8 14 h5 l12 -14z"/><path d="M14 3 l-6 -10 h4 l10 10z"/></g>`+sea(78)+
        `<path d="M0 82 L30 60 H120 V96 H0Z" fill="#e6d8bc"/>${[[6,74,22,10],[22,64,24,12],[46,58,26,14],[74,54,24,16],[96,60,22,12]].map(([x,y,w,h])=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fbfaf6"/><rect x="${x}" y="${y+h-4}" width="${w}" height="2" fill="#d9cdb4"/>`).join('')}`+
        `<path d="M0 98 h120 v22 h-120z" fill="#f1e3c4"/>`; break;
      default: body=cloud(30,30);
    }
    return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${sky}${body}</svg>`;
  }

  Trip.lib.scenes = { render };
})(window.Trip);
