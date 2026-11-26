// Resolve next to the shipped module, not the domain root: /lx/ deployments
// must use /lx/api/ rather than accidentally contacting another site's API.
export function networkEndpoint(path, moduleUrl=import.meta.url){
  if(!path.startsWith('/api/'))return path;
  const base=new URL('./',moduleUrl);
  if(!['http:','https:'].includes(base.protocol))return path;
  return new URL(path.slice(1),base).href;
}
