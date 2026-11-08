export const INSTRUMENTS=[
  {id:'signal',name:'Signal',batch:0,description:'Filter galaxy · voice ring',colors:['#e83b77','#79d9ff'],href:'./index.html'},
  {id:'relay',name:'Relay / Resonator',description:'Plucked metal · modal resonance',colors:['#ff7249','#88b9c8'],load:()=>import('./relay.js')},
  {id:'cellular',name:'Cellular / Automata',batch:1,description:'Contact assembly · cellular automaton',colors:['#85e4ee','#9d293c'],load:()=>import('./cellular.js')},
  {id:'census',name:'Cell Census',batch:1,description:'Scan routing · spectrum · EQ',colors:['#d8ff23','#ff568f'],load:()=>import('./census.js')},
  {id:'swarm',name:'Machine / Swarm',batch:2,description:'Pitch lanes · gesture flow',colors:['#e6ce6a','#a29afa'],load:()=>import('./swarm.js')},
  {id:'graticule',name:'Graticule / Lissajous',batch:2,description:'Sonar note map · oscillator phase',colors:['#f3a64c','#8eb9ff'],load:()=>import('./graticule.js')},
  {id:'waveform',name:'Machine / Man',batch:2,description:'Touch transfer · sampled synthesis',colors:['#d96c64','#a2c0ae'],load:()=>import('./waveform.js')},
  {id:'geo',name:'GeoSynth',batch:3,description:'Note map · wavetable transfer',colors:['#f5cc37','#ed978e'],load:()=>import('./geo.js')},
  {id:'hand',name:'Etching / Machine',batch:3,description:'Drafted ring · digital envelope',colors:['#dccbf0','#6982d7'],load:()=>import('./hand.js')},
  {id:'structure',name:'Structural Score',batch:3,description:'Crossed synthesis lanes · strummed strings',colors:['#ae7cdd','#d6eab3'],load:()=>import('./structure.js')},
  {id:'granular',name:'Past / Future',batch:3,description:'Buffer history · granular playback',colors:['#dfce57','#b4c6e3'],load:()=>import('./granular.js')},
  {id:'terrain',name:'Timbre Terrain',batch:4,description:'Preserved contour field · note map',colors:['#dfdf58','#c99870'],load:()=>import('./terrain.js')},
  {id:'phase-volume',name:'Phase Volume',batch:4,description:'Delayed oscillator slices · point volume',colors:['#8eb9ff','#434b9c'],load:()=>import('./phase-volume.js')},
  {id:'milkdrop',name:'MilkDrop',description:'Audio-reactive feedback · touch synthesis',colors:['#62efd9','#c180ff'],load:()=>import('./milkdrop.js')},
  {id:'receiver',name:'Receiver',description:'Signal tracking · detuned synthesis',colors:['#bccac8','#31444f'],load:()=>import('./receiver.js')},
];

// Old home-screen links select the replacement without importing its retired
// parameter schema or overwriting the user's archived Carrier session.
export const resolveInstrumentId=id=>id==='carrier'?'relay':id;
