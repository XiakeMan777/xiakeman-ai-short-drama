export async function listen<T = unknown>(
  _eventName?: string,
  _handler?: (event: { payload: T }) => void,
) {
  return () => undefined;
}
