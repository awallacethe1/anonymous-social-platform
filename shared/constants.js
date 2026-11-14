// Used by both the server and the interface.

export const INTERESTS = [
  'Fashion', 'Design', 'Music', 'Film', 'Books', 'Tech', 'Travel', 'Fitness',
  'Art', 'Writing', 'Business', 'Games', 'Beauty', 'Lifestyle', 'Education',
];

export const REPORT_REASONS = [
  ['harassment', 'Harassment or bullying'],
  ['hate', 'Hate or discrimination'],
  ['threats', 'Threats or violence'],
  ['sexual', 'Sexual content'],
  ['self-harm', 'Self-harm'],
  ['spam', 'Spam or scams'],
  ['impersonation', 'Pretending to be someone else'],
  ['other', 'Something else'],
];

export const LIMITS = {
  post: 2000, comment: 1000, bio: 300, displayName: 50, question: 500, answer: 2000,
  message: 2000, boardName: 60, reportDetails: 1000, tagsPerPost: 3,
  upload: 5 * 1024 * 1024, json: 64 * 1024,
};
