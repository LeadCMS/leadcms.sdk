/**
 * Type augmentation for Jest 29 ESM-specific APIs not yet in @types/jest.
 * jest.unstable_mockModule is part of Jest's native ESM support.
 */
declare namespace jest {
    function unstable_mockModule<T extends object>(
        moduleName: string,
        moduleFactory: () => T | Promise<T>,
        options?: { virtual?: boolean }
    ): typeof jest;
}
