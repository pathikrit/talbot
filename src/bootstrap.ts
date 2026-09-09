// Keep a failed module/dependency fetch from leaving a completely blank page.
void import('./main').catch(error => {
  console.error('Talbot startup failed:', error);
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = 'Talbot could not load. Refresh the page to retry.';
  document.getElementById('app')?.replaceChildren(message);
});
