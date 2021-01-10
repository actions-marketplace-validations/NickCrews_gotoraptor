// Here is a file with a pre-existing goto. Deleting it should not trigger a
// warning
int main() {
  int i = 0;
  label:
  i++;
  if (i<5) {
    goto label;
  }
  return i;
}
