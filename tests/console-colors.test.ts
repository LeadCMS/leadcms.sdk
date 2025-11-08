describe('Console Colors', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let mockConsole: any;
  let colorConsole: any;
  let diffColors: any;
  let statusColors: any;
  let success: any;
  let error: any;
  let warn: any;
  let info: any;
  let debug: any;
  let progress: any;
  let important: any;
  let log: any;

  beforeEach(async () => {
    originalEnv = process.env;

    // Reset environment to enable colors
    delete process.env.NO_COLOR;
    delete process.env.NODE_DISABLE_COLORS;
    process.env.FORCE_COLOR = '1';

    // Mock process.stdout.isTTY to enable colors
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true,
      configurable: true
    });

    // Clear module cache to ensure color state is reset
    jest.resetModules();

    // Mock console methods
    mockConsole = {};
    mockConsole.log = jest.spyOn(console, 'log').mockImplementation();
    mockConsole.error = jest.spyOn(console, 'error').mockImplementation();
    mockConsole.warn = jest.spyOn(console, 'warn').mockImplementation();
    mockConsole.info = jest.spyOn(console, 'info').mockImplementation();

    // Import modules after environment setup
    const module = require('../src/lib/console-colors');
    colorConsole = module.colorConsole;
    diffColors = module.diffColors;
    statusColors = module.statusColors;
    success = module.success;
    error = module.error;
    warn = module.warn;
    info = module.info;
    debug = module.debug;
    progress = module.progress;
    important = module.important;
    log = module.log;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
    jest.resetModules();
  });

  describe('colorConsole methods', () => {
    it('should log success messages in green', () => {
      colorConsole.success('Success message');
      expect(mockConsole.log).toHaveBeenCalledWith('\x1b[32mSuccess message\x1b[0m');
    });

    it('should log error messages in red', () => {
      colorConsole.error('Error message');
      expect(mockConsole.error).toHaveBeenCalledWith('\x1b[31mError message\x1b[0m');
    });

    it('should log warning messages in yellow', () => {
      colorConsole.warn('Warning message');
      expect(mockConsole.warn).toHaveBeenCalledWith('\x1b[33mWarning message\x1b[0m');
    });

    it('should log info messages in cyan', () => {
      colorConsole.info('Info message');
      expect(mockConsole.log).toHaveBeenCalledWith('\x1b[36mInfo message\x1b[0m');
    });

    it('should log debug messages in gray', () => {
      colorConsole.debug('Debug message');
      expect(mockConsole.log).toHaveBeenCalledWith('\x1b[90mDebug message\x1b[0m');
    });

    it('should log progress messages in blue', () => {
      colorConsole.progress('Progress message');
      expect(mockConsole.log).toHaveBeenCalledWith('\x1b[34mProgress message\x1b[0m');
    });

    it('should log important messages in bright', () => {
      colorConsole.important('Important message');
      expect(mockConsole.log).toHaveBeenCalledWith('\x1b[1mImportant message\x1b[0m');
    });

    it('should handle additional arguments', () => {
      colorConsole.success('Message', 'arg1', 42);
      expect(mockConsole.log).toHaveBeenCalledWith('\x1b[32mMessage\x1b[0m', 'arg1', 42);
    });

    it('should convert non-string messages to strings', () => {
      colorConsole.error(404);
      expect(mockConsole.error).toHaveBeenCalledWith('\x1b[31m404\x1b[0m');
    });
  });

  describe('color utility functions', () => {
    it('should apply colors correctly', () => {
      expect(colorConsole.red('text')).toBe('\x1b[31mtext\x1b[0m');
      expect(colorConsole.green('text')).toBe('\x1b[32mtext\x1b[0m');
      expect(colorConsole.yellow('text')).toBe('\x1b[33mtext\x1b[0m');
      expect(colorConsole.blue('text')).toBe('\x1b[34mtext\x1b[0m');
      expect(colorConsole.cyan('text')).toBe('\x1b[36mtext\x1b[0m');
      expect(colorConsole.gray('text')).toBe('\x1b[90mtext\x1b[0m');
      expect(colorConsole.bold('text')).toBe('\x1b[1mtext\x1b[0m');
    });

    it('should highlight text correctly', () => {
      expect(colorConsole.highlight('text')).toBe('\x1b[1m\x1b[36mtext\x1b[0m');
    });
  });

  describe('color disabling', () => {
    it('should disable colors when NO_COLOR is set', () => {
      process.env.NO_COLOR = '1';

      colorConsole.success('Success message');
      expect(mockConsole.log).toHaveBeenCalledWith('Success message');
    });

    it('should disable colors when not in TTY', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        configurable: true
      });

      colorConsole.error('Error message');
      expect(mockConsole.error).toHaveBeenCalledWith('Error message');
    });

    it('should return plain text for color functions when colors disabled', () => {
      process.env.NO_COLOR = '1';

      expect(colorConsole.red('text')).toBe('text');
      expect(colorConsole.highlight('text')).toBe('text');
    });
  });

  describe('diffColors', () => {
    it('should apply diff colors correctly', () => {
      expect(diffColors.added('text')).toBe('\x1b[32mtext\x1b[0m');
      expect(diffColors.removed('text')).toBe('\x1b[31mtext\x1b[0m');
      expect(diffColors.modified('text')).toBe('\x1b[33mtext\x1b[0m');
      expect(diffColors.unchanged('text')).toBe('text');
      expect(diffColors.header('text')).toBe('\x1b[1m\x1b[36mtext\x1b[0m');
      expect(diffColors.lineNumber('text')).toBe('\x1b[90mtext\x1b[0m');
    });

    it('should respect color disabling for diff colors', () => {
      process.env.NO_COLOR = '1';

      expect(diffColors.added('text')).toBe('text');
      expect(diffColors.removed('text')).toBe('text');
      expect(diffColors.header('text')).toBe('text');
    });
  });

  describe('statusColors', () => {
    it('should apply status colors correctly', () => {
      expect(statusColors.created('text')).toBe('\x1b[32mtext\x1b[0m');
      expect(statusColors.modified('text')).toBe('\x1b[33mtext\x1b[0m');
      expect(statusColors.renamed('text')).toBe('\x1b[34mtext\x1b[0m');
      expect(statusColors.conflict('text')).toBe('\x1b[31mtext\x1b[0m');
      expect(statusColors.synced('text')).toBe('\x1b[32mtext\x1b[0m');
      expect(statusColors.typeChange('text')).toBe('\x1b[35mtext\x1b[0m');
    });

    it('should respect color disabling for status colors', () => {
      process.env.NO_COLOR = '1';

      expect(statusColors.created('text')).toBe('text');
      expect(statusColors.conflict('text')).toBe('text');
      expect(statusColors.typeChange('text')).toBe('text');
    });
  });

  describe('exported convenience functions', () => {
    it('should work as direct exports', () => {
      success('Success message');
      expect(mockConsole.log).toHaveBeenCalledWith('\x1b[32mSuccess message\x1b[0m');

      error('Error message');
      expect(mockConsole.error).toHaveBeenCalledWith('\x1b[31mError message\x1b[0m');

      warn('Warning message');
      expect(mockConsole.warn).toHaveBeenCalledWith('\x1b[33mWarning message\x1b[0m');

      info('Info message');
      expect(mockConsole.log).toHaveBeenCalledWith('\x1b[36mInfo message\x1b[0m');

      debug('Debug message');
      expect(mockConsole.log).toHaveBeenCalledWith('\x1b[90mDebug message\x1b[0m');

      progress('Progress message');
      expect(mockConsole.log).toHaveBeenCalledWith('\x1b[34mProgress message\x1b[0m');

      important('Important message');
      expect(mockConsole.log).toHaveBeenCalledWith('\x1b[1mImportant message\x1b[0m');

      log('Regular message');
      expect(mockConsole.log).toHaveBeenCalledWith('Regular message');
    });
  });
});
