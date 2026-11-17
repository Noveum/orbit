const EDGE_ADDRESS_HEADER = 'cf-connecting-ip';
const FORWARDED_HEADER = 'x-forwarded-for';

export function withEdgeClientAddress(request: Request): Request {
  const address = request.headers.get(EDGE_ADDRESS_HEADER);
  const headers = new Headers(request.headers);
  if (address === null) headers.delete(FORWARDED_HEADER);
  else headers.set(FORWARDED_HEADER, address);
  return new Request(request, { headers });
}
