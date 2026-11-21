const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

// A connection string can name several hosts, and every one of them must be local.
export function isLocalDatabase(hosts: readonly string[]): boolean {
  return hosts.length > 0 && hosts.every((host) => LOCAL_HOSTS.includes(host));
}
