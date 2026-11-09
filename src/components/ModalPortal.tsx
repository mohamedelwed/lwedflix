'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders children into <body>.
 *
 * Necessary because the video player is itself portaled to <body> at a
 * z-index, while page content lives inside containers that establish
 * their own stacking contexts (e.g. `relative z-20`). A modal rendered
 * inline is trapped in that context and paints UNDER the player no
 * matter how high its own z-index goes. Portaling escapes it.
 */
const ModalPortal = ({ children }: { children: React.ReactNode }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;
  // data-tv-layer: the TV app keeps remote navigation inside the open modal,
  // and Back clicks its backdrop (src/components/tv/TvNavigation.tsx).
  return createPortal(<div data-tv-layer="">{children}</div>, document.body);
};

export default ModalPortal;
