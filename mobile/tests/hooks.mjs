const electron = new URL('../../electron/', import.meta.url);

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@electron/')) {
    return next(new URL(`${specifier.slice('@electron/'.length)}.js`, electron).href, context);
  }
  return next(specifier, context);
}
