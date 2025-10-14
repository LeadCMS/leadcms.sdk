#!/bin/bash

# Release script for LeadCMS SDK
# Usage: ./scripts/release.sh [patch|minor|major] [message]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
VERSION_TYPE=${1:-patch}
COMMIT_MESSAGE=${2:-"Release version"}

echo -e "${BLUE}🚀 LeadCMS SDK Release Script${NC}"
echo "================================"

# Validate git status
if [[ -n $(git status --porcelain) ]]; then
    echo -e "${RED}❌ Working directory is not clean. Please commit or stash changes.${NC}"
    exit 1
fi

# Ensure we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
    echo -e "${YELLOW}⚠️  Not on main branch (currently on: $CURRENT_BRANCH)${NC}"
    read -p "Continue anyway? [y/N]: " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${BLUE}📦 Current version: ${CURRENT_VERSION}${NC}"

# Build and test
echo -e "${BLUE}🔨 Building and testing...${NC}"
npm run build
npm test

# Bump version
echo -e "${BLUE}📈 Bumping version (${VERSION_TYPE})...${NC}"
NEW_VERSION=$(npm version $VERSION_TYPE --no-git-tag-version)
echo -e "${GREEN}📦 New version: ${NEW_VERSION}${NC}"

# Update git
echo -e "${BLUE}📝 Committing changes...${NC}"
git add package.json package-lock.json
git commit -m "$COMMIT_MESSAGE $NEW_VERSION"

# Create and push tag
echo -e "${BLUE}🏷️  Creating git tag...${NC}"
git tag $NEW_VERSION
git push origin main --tags

echo -e "${GREEN}✅ Release $NEW_VERSION created successfully!${NC}"
echo
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Go to GitHub and create a release from tag $NEW_VERSION"
echo "2. GitHub Actions will automatically publish to npm"
echo "3. Monitor the Actions tab for deployment status"
echo
echo -e "${BLUE}GitHub release URL:${NC}"
echo "https://github.com/LeadCMS/leadcms.sdk/releases/new?tag=$NEW_VERSION"
