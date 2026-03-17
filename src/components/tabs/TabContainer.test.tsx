import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TabContainer } from './TabContainer';

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

// Mock event coordinator hook
vi.mock('@/hooks/useEventCoordinator', () => ({
  useEventCoordinator: () => ({
    registerEvent: vi.fn(),
    unregisterEvent: vi.fn(),
  }),
}));

// Mock all tab components with simple test versions
vi.mock('./CyberdriverHomeTab', () => ({
  CyberdriverHomeTab: () => <div data-testid="home-tab">Home</div>
}));

vi.mock('./RecordingsTab', () => ({
  RecordingsTab: () => <div data-testid="recordings-tab">Recordings</div>
}));

vi.mock('./ModelsTab', () => ({
  ModelsTab: () => <div data-testid="models-tab">Models</div>
}));

vi.mock('./CyberdriverSettingsTab', () => ({
  CyberdriverSettingsTab: () => <div data-testid="settings-tab">Settings</div>
}));

vi.mock('./AboutTab', () => ({
  AboutTab: () => <div data-testid="about-tab">About</div>
}));

describe('TabContainer', () => {
  it('renders correct tab based on activeSection', () => {
    const { rerender } = render(
      <TabContainer activeSection="home" onSectionChange={vi.fn()} />
    );
    expect(screen.getByTestId('home-tab')).toBeInTheDocument();
    
    rerender(<TabContainer activeSection="recordings" onSectionChange={vi.fn()} />);
    expect(screen.getByTestId('recordings-tab')).toBeInTheDocument();
    
    rerender(<TabContainer activeSection="models" onSectionChange={vi.fn()} />);
    expect(screen.getByTestId('models-tab')).toBeInTheDocument();
    
    rerender(<TabContainer activeSection="settings" onSectionChange={vi.fn()} />);
    expect(screen.getByTestId('settings-tab')).toBeInTheDocument();
    
    rerender(<TabContainer activeSection="about" onSectionChange={vi.fn()} />);
    expect(screen.getByTestId('about-tab')).toBeInTheDocument();
  });

  it('renders home tab for unknown sections', () => {
    render(<TabContainer activeSection="unknown" onSectionChange={vi.fn()} />);
    expect(screen.getByTestId('home-tab')).toBeInTheDocument();
  });
});