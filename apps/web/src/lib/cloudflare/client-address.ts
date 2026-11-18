const EDGE_ADDRESS_HEADER = 'cf-connecting-ip';
const FORWARDED_HEADER = 'x-forwarded-for';

export function withEdgeClientAddress(request: Request): Request {
  const trusted = new Request(request);
  const address = request.headers.get(EDGE_ADDRESS_HEADER);
  if (address === null) trusted.headers.delete(FORWARDED_HEADER);
  else trusted.headers.set(FORWARDED_HEADER, address);
  return trusted;
}
