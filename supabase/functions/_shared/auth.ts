export function checkSecret(req: Request, expected: string): boolean {
  const secret = req.headers.get("x-secret");
  return !!secret && secret === expected;
}
