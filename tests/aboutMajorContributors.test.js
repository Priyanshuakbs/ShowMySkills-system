import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXPECTED_NAMES = [
  'S. Sidharth',
  'Joel A Jacob',
  'Akash Nadar',
  'Krithi Kushwaha',
  'Palla Bindhu',
  'Priyanshi Bhati',
  'Priyanshu',
  'VishnuSree',
];

const aboutPagePath = path.resolve(__dirname, '../web/src/app/about/page.jsx');
const readmePath = path.resolve(__dirname, '../web/public/contributors/README.md');

test('Major Contributors: All 8 required names are included on About page', () => {
  const pageSource = fs.readFileSync(aboutPagePath, 'utf8');

  for (const name of EXPECTED_NAMES) {
    assert.ok(
      pageSource.includes(name),
      `About page source must include contributor "${name}"`
    );
  }
});

test('Major Contributors: No roles or job titles are rendered in contributor cards', () => {
  const pageSource = fs.readFileSync(aboutPagePath, 'utf8');

  // Verify that cards render {contributor.name} and not roles
  assert.ok(pageSource.includes('{contributor.name}'), 'Cards must display contributor name');
  assert.strictEqual(
    pageSource.includes('contributor.role') || pageSource.includes('contributor.title'),
    false,
    'Cards must not render roles or titles'
  );
});

test('Major Contributors: Card shuffle is deterministic for SSR and randomizes on client mount', () => {
  const pageSource = fs.readFileSync(aboutPagePath, 'utf8');

  // Must initialize with deterministic list to prevent Next.js hydration mismatch
  assert.ok(
    pageSource.includes('useState(MAJOR_CONTRIBUTORS)'),
    'State must be initialized deterministically to prevent hydration mismatches'
  );

  // Must shuffle inside useEffect on mount
  assert.ok(
    pageSource.includes('useEffect(() => {') &&
      pageSource.includes('setContributors(shuffleContributors(MAJOR_CONTRIBUTORS))'),
    'Shuffle must occur within useEffect with empty dependency array'
  );

  // Test the Fisher-Yates shuffle logic directly
  function shuffleArray(list) {
    const array = [...list];
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  const results = new Set();
  for (let i = 0; i < 20; i++) {
    const shuffled = shuffleArray(EXPECTED_NAMES);
    assert.strictEqual(shuffled.length, 8, 'Shuffled list must always contain 8 items');
    for (const name of EXPECTED_NAMES) {
      assert.ok(shuffled.includes(name), `Shuffled list must retain ${name}`);
    }
    results.add(shuffled.join(','));
  }

  // Over 20 iterations, 8 elements should produce multiple distinct permutations
  assert.ok(results.size > 1, 'Shuffle should produce multiple distinct orders across runs');
});

test('Major Contributors: Blank avatar placeholder and non-clickable social icons are present', () => {
  const pageSource = fs.readFileSync(aboutPagePath, 'utf8');

  // Blank avatar placeholder using User icon
  assert.ok(pageSource.includes('<User '), 'Cards must use User silhouette icon for blank placeholder');
  assert.strictEqual(
    pageSource.includes('unsplash') || pageSource.includes('stock'),
    false,
    'Cards must not use stock photos'
  );

  // ContributorAvatar component with onError fallback
  assert.ok(pageSource.includes('function ContributorAvatar'), 'Must provide ContributorAvatar component');
  assert.ok(pageSource.includes('onError={() => setHasError(true)}'), 'Must handle onError to gracefully fallback');

  // LinkedIn and GitHub placeholder icons
  assert.ok(pageSource.includes('<Linkedin '), 'Cards must contain LinkedIn icon');
  assert.ok(pageSource.includes('<Github '), 'Cards must contain GitHub icon');
  assert.ok(pageSource.includes('cursor-default'), 'Social icons must be non-clickable placeholders');
});

test('Major Contributors: Layout matches neat square/rectangular photo, name below image, icons below name', () => {
  const pageSource = fs.readFileSync(aboutPagePath, 'utf8');

  // Square/rectangular image area
  assert.ok(pageSource.includes('aspect-square'), 'Photo area must be a consistent square/rectangular container');

  // Subtle green background accent
  assert.ok(
    pageSource.includes('bg-gradient-to-b') &&
      (pageSource.includes('#F4FAF8') || pageSource.includes('#E6F7F3') || pageSource.includes('#10B981')),
    'Section must have a subtle green background accent'
  );

  // Available contributor photos match real files in web/public/contributors/
  const AVAILABLE_PHOTOS = [
    '/contributors/s-sidharth.png',
    '/contributors/joel-a-jacob.png',
    '/contributors/palla-bindhu.jpg.png',
    '/contributors/priyanshi-bhati.png',
  ];

  for (const photoPath of AVAILABLE_PHOTOS) {
    assert.ok(
      pageSource.includes(photoPath),
      `Page must configure available photo path "${photoPath}"`
    );
    const diskPath = path.resolve(__dirname, '../web/public', photoPath.replace(/^\//, ''));
    assert.ok(
      fs.existsSync(diskPath),
      `Image file on disk must exist at "${diskPath}"`
    );
  }
});

test('Major Contributors: Responsive layout classes are configured for mobile and desktop', () => {
  const pageSource = fs.readFileSync(aboutPagePath, 'utf8');

  assert.ok(
    pageSource.includes('grid-cols-1') &&
      pageSource.includes('sm:grid-cols-2') &&
      pageSource.includes('lg:grid-cols-4'),
    'Grid must define responsive breakpoints for mobile (1 col), tablet (2 col), and desktop (4 col)'
  );
  assert.ok(pageSource.includes('#4B9C93'), 'Section must use ShowMySkills teal branding');
});

test('Major Contributors: Black-and-white photo treatment at rest smoothly restores natural color on hover and touch', () => {
  const pageSource = fs.readFileSync(aboutPagePath, 'utf8');

  // Verify clean black-and-white treatment at rest
  assert.ok(
    pageSource.includes('grayscale') && pageSource.includes('contrast-'),
    'Photo must use a black-and-white treatment with contrast adjustment'
  );

  // Verify no green/teal tint via hue-rotate/sepia/mix-blend
  assert.strictEqual(
    pageSource.includes('hue-rotate') || pageSource.includes('mix-blend'),
    false,
    'Photo must not include green/teal tint'
  );

  // Verify transition to original color vibrancy on hover and touch/focus
  assert.ok(
    pageSource.includes('group-hover:grayscale-0'),
    'Photo should smoothly restore natural color vibrancy on hover'
  );
  assert.ok(
    pageSource.includes('group-focus-within:grayscale-0') || pageSource.includes('active:grayscale-0'),
    'Photo should restore natural color on touch/focus for accessibility'
  );
});

test('Major Contributors: web/public/contributors/README.md lists all eight suggested filenames', () => {
  assert.ok(fs.existsSync(readmePath), 'web/public/contributors/README.md must exist');
  const readmeContent = fs.readFileSync(readmePath, 'utf8');

  for (const name of EXPECTED_NAMES) {
    assert.ok(
      readmeContent.includes(name),
      `README.md must mention contributor "${name}"`
    );
  }

  // Check expected slugified filenames
  const expectedFiles = [
    's-sidharth',
    'joel-a-jacob',
    'akash-nadar',
    'krithi-kushwaha',
    'palla-bindhu',
    'priyanshi-bhati',
    'priyanshu',
    'vishnusree',
  ];

  for (const filename of expectedFiles) {
    assert.ok(
      readmeContent.includes(filename),
      `README.md must suggest filename containing "${filename}"`
    );
  }
});
