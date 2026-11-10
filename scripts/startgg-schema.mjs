// Saves start.gg's whole public API schema to docs/startgg-schema.graphql, so what the API has can be
// looked up instead of guessed. Run: STARTGG_TOKEN=... node scripts/startgg-schema.mjs
import fs from 'fs';
const H={'content-type':'application/json',authorization:'Bearer '+process.env.STARTGG_TOKEN};
const q=`query{__schema{queryType{name} mutationType{name} types{kind name description fields(includeDeprecated:true){name description isDeprecated args{name description type{...T} defaultValue} type{...T}} inputFields{name description type{...T} defaultValue} enumValues(includeDeprecated:true){name description} possibleTypes{name} interfaces{name}}}}
fragment T on __Type{kind name ofType{kind name ofType{kind name ofType{kind name ofType{kind name}}}}}`;
const j=await (await fetch('https://api.start.gg/gql/alpha',{method:'POST',headers:H,body:JSON.stringify({query:q})})).json();
if(j.errors){console.error(JSON.stringify(j.errors));process.exit(1)}
const s=j.data.__schema;
const t=x=>x.kind==='NON_NULL'?t(x.ofType)+'!':x.kind==='LIST'?'['+t(x.ofType)+']':x.name;
const d=(x,ind='')=>x?`${ind}"""${x.replace(/\s+/g,' ').trim()}"""\n`:'';
let out=[`# start.gg public GraphQL API schema (https://api.start.gg/gql/alpha), from introspection on ${new Date().toISOString().slice(0,10)}.\n# Regenerate: node scripts/startgg-schema.mjs (needs STARTGG_TOKEN).\n`];
for(const ty of s.types.filter(x=>!x.name.startsWith('__')).sort((a,b)=>a.name.localeCompare(b.name))){
 let o=d(ty.description);
 if(ty.kind==='SCALAR'){out.push(o+`scalar ${ty.name}\n`);continue}
 if(ty.kind==='ENUM'){out.push(o+`enum ${ty.name} {\n`+ty.enumValues.map(v=>d(v.description,'  ')+'  '+v.name).join('\n')+'\n}\n');continue}
 if(ty.kind==='UNION'){out.push(o+`union ${ty.name} = ${ty.possibleTypes.map(p=>p.name).join(' | ')}\n`);continue}
 const kw={OBJECT:'type',INTERFACE:'interface',INPUT_OBJECT:'input'}[ty.kind];
 const impl=ty.interfaces?.length?' implements '+ty.interfaces.map(i=>i.name).join(' & '):'';
 const fields=(ty.fields||ty.inputFields).map(f=>{
  const args=f.args?.length?'('+f.args.map(a=>a.name+': '+t(a.type)+(a.defaultValue!=null?' = '+a.defaultValue:'')).join(', ')+')':'';
  return d(f.description,'  ')+'  '+f.name+args+': '+t(f.type)+(f.isDeprecated?' @deprecated':'')+(f.defaultValue!=null?' = '+f.defaultValue:'');
 });
 out.push(o+`${kw} ${ty.name}${impl} {\n${fields.join('\n')}\n}\n`);
}
fs.writeFileSync(new URL('../docs/startgg-schema.graphql', import.meta.url),out.join('\n'));
