// Mappa Leaflet dentro una WebView: nessuna chiave API, stessi sfondi di Aeronav (stradale / satellite).
import React, { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
html,body,#map{height:100%;margin:0;background:#090e17}
.team-pin{position:relative;transform:translate(-8px,-8px)}
.team-pin .dot{display:block;width:16px;height:16px;border-radius:50%;background:var(--c);border:2px solid #fff;box-shadow:0 0 3px #000}
.team-pin.you .dot{width:18px;height:18px;border:3px solid #f59e0b}
.team-pin .lbl{position:absolute;left:22px;top:-2px;white-space:nowrap;font:600 12px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.7);padding:1px 5px;border-radius:4px}
.team-pin.stale{opacity:.5}
#fit{position:absolute;z-index:1000;left:10px;bottom:24px;background:#1e293b;color:#f8fafc;border:0;border-radius:8px;padding:12px 16px;font:700 13px system-ui,sans-serif;letter-spacing:1px}
#empty{position:absolute;z-index:1000;left:50%;top:14px;transform:translateX(-50%);background:rgba(0,0,0,.75);color:#cbd5e1;border-radius:8px;padding:6px 10px;font:12px system-ui,sans-serif}
</style></head><body>
<div id="map"></div><button id="fit">CENTRA</button><div id="empty">In attesa di posizioni…</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('map').setView([42,12.5],5);
var osm=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Esri'});
L.control.layers({'Stradale':osm,'Satellite':sat}).addTo(map);
var markers={}, fitted=false, last=[];
function color(id){return 'hsl('+(parseInt(String(id).slice(0,4),16)%360)+',75%,55%)';}
function fit(){
  var pts=last.map(function(m){return [m.lat,m.lon];});
  if(!pts.length)return;
  if(pts.length===1)map.setView(pts[0],Math.max(map.getZoom(),15));
  else map.fitBounds(pts,{padding:[50,50],maxZoom:17});
}
window.setMembers=function(list){
  last=list.filter(function(m){return m.lat!=null&&m.lon!=null&&m.age!=null&&m.age<600;});
  document.getElementById('empty').style.display=last.length?'none':'block';
  var seen={};
  last.forEach(function(m){
    seen[m.id]=1;
    var stale=m.age>30;
    var el=document.createElement('div');
    el.className='team-pin'+(stale?' stale':'')+(m.you?' you':'');
    el.style.setProperty('--c',color(m.id));
    var dot=document.createElement('span');dot.className='dot';
    var lbl=document.createElement('span');lbl.className='lbl';
    lbl.textContent=(m.you?'tu':m.nick)+(isFinite(m.alt)&&m.alt!==null?' '+Math.round(m.alt*3.28084)+' ft':'');
    el.appendChild(dot);el.appendChild(lbl);
    var icon=L.divIcon({html:el,className:'',iconSize:[0,0]});
    var mk=markers[m.id];
    if(!mk){markers[m.id]=L.marker([m.lat,m.lon],{icon:icon,keyboard:false}).addTo(map);}
    else{mk.setLatLng([m.lat,m.lon]);mk.setIcon(icon);}
  });
  Object.keys(markers).forEach(function(id){if(!seen[id]){map.removeLayer(markers[id]);delete markers[id];}});
  if(!fitted&&last.length){fitted=true;fit();}
};
document.getElementById('fit').addEventListener('click',fit);
window.ReactNativeWebView.postMessage('ready');
</script></body></html>`;

export default function TeamMap({ members, version }) {
  const ref = useRef(null);
  const ready = useRef(false);
  const latest = useRef(members);
  latest.current = members;

  const push = () => {
    if (ref.current && ready.current) {
      ref.current.injectJavaScript('window.setMembers(' + JSON.stringify(latest.current || []) + ');true;');
    }
  };

  useEffect(push, [version]);

  return (
    <WebView
      ref={ref}
      style={s.web}
      originWhitelist={['*']}
      source={{ html: HTML, baseUrl: 'https://aeronav-team.app/' }} // il referer evita il blocco dei tasselli OSM
      javaScriptEnabled
      domStorageEnabled
      onMessage={(e) => { if (e.nativeEvent.data === 'ready') { ready.current = true; push(); } }}
    />
  );
}

const s = StyleSheet.create({ web: { flex: 1, backgroundColor: '#090e17' } });
