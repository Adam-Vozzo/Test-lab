export const INSTRUMENTS=[
  {id:'signal',name:'Signal',batch:0,description:'Filter galaxy · voice ring',colors:['#e83b77','#79d9ff'],href:'./index.html'},
  {id:'carrier',name:'Carrier / Modulator',batch:1,description:'Two-hand frequency modulation',colors:['#ef785d','#8372d6'],load:()=>import('./carrier.js')},
  {id:'cellular',name:'Cellular Field',batch:1,description:'Polyphonic cellular touch field',colors:['#85e4ee','#c6ee9c'],load:()=>import('./cellular.js')},
  {id:'census',name:'Cell Census',batch:1,description:'Hex sequence · timbre regions',colors:['#f8b536','#6d83e5'],load:()=>import('./census.js')},
  {id:'swarm',name:'Machine / Swarm',batch:2,description:'Pitch lanes · gesture flow',colors:['#e6ce6a','#a29afa'],load:()=>import('./swarm.js')},
  {id:'graticule',name:'Graticule / Lissajous',batch:2,description:'Polar notes · harmonic phase',colors:['#f3a64c','#8eb9ff'],load:()=>import('./graticule.js')},
  {id:'waveform',name:'Machine / Man',batch:2,description:'Wave shaping · sixteen steps',colors:['#d96c64','#a2c0ae'],load:()=>import('./waveform.js')},
  {id:'geo',name:'GeoSynth',batch:3,description:'Note map · timbral terrain',colors:['#f5cc37','#ed978e'],load:()=>import('./geo.js')},
  {id:'hand',name:'Hand / Machine',batch:3,description:'Expressive keys · voice analysis',colors:['#dccbf0','#6982d7'],load:()=>import('./hand.js')},
  {id:'structure',name:'Structural Score',batch:3,description:'Geometric sequence · spectral loop',colors:['#ae7cdd','#d6eab3'],load:()=>import('./structure.js')},
  {id:'granular',name:'Past / Future',batch:3,description:'Buffer history · granular playback',colors:['#dfce57','#b4c6e3'],load:()=>import('./granular.js')},
];
