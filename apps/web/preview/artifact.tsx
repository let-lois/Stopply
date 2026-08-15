// A self-contained build of the prototypes preview, for looking at while the
// Pages deploys are broken.
//
// Mounts the real PrototypesPage and PrototypePreviewPage, and the real rep
// app, with two things stood in for: the router (MemoryRouter, since there is
// no server to route against) and the network (the same fixtures the deployed
// version uses). Nothing else is a mock.
//
// Not committed and not part of any build that ships. It exists to hand
// somebody a link when the pipeline cannot.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import FieldApp from '@/field/FieldApp';
import PrototypesPage from '@/platform/prototypes/PrototypesPage';
import PrototypePreviewPage from '@/platform/prototypes/PrototypePreviewPage';
import { PROTOTYPES } from '@/platform/prototypes/registry';
import { installFieldFixtures } from '@/platform/prototypes/fixtures';
import '@/index.css';

declare global {
  interface Window {
    __mountRep?: () => void;
    __mountGallery?: () => void;
  }
}

// The preview page builds its iframe src from the registry's target. There is
// no server here to serve /field, so it points at a blank document and the
// page script writes the rep app into it instead. The fragment keeps
// `about:blank#?fixtures=1` a valid URL that loads blank.
PROTOTYPES.forEach((app) => {
  app.target = 'about:blank#';
});

// ThemeProvider wraps both, the same way App.tsx puts it outermost: the rep
// app carries a theme toggle and the palette is read through it.
function mount(node: React.ReactNode) {
  const el = document.getElementById('root');
  if (!el) throw new Error('#root missing');
  createRoot(el).render(
    <StrictMode>
      <ThemeProvider>{node}</ThemeProvider>
    </StrictMode>
  );
}

window.__mountRep = () => {
  installFieldFixtures();
  // FieldApp renders <Routes>, so it needs a router of its own in here.
  mount(
    <MemoryRouter initialEntries={['/']}>
      <FieldApp />
    </MemoryRouter>
  );
};

window.__mountGallery = () => {
  mount(
    <MemoryRouter initialEntries={['/prototypes']}>
      <Routes>
        <Route path="/prototypes" element={<PrototypesPage />} />
        <Route path="/prototypes/:appId" element={<PrototypePreviewPage />} />
      </Routes>
    </MemoryRouter>
  );
};
