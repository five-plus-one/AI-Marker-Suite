use strict;
use warnings;
use Errno qw(EINTR);
use POSIX qw(WIFSIGNALED WTERMSIG WEXITSTATUS);

# The CI image runs on Linux x86_64. Adopt Chromium's detached helpers so
# completed browser runs do not leave zombies behind in the job container.
use constant SYS_PRCTL => 157;
use constant PR_SET_CHILD_SUBREAPER => 36;
syscall(SYS_PRCTL, PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) == 0
    or die "Could not register Chromium child reaper: $!";

my $browser = fork();
defined $browser or die "Could not start Chromium: $!";
if ($browser == 0) {
    exec @ARGV or die "Could not execute Chromium: $!";
}

$SIG{TERM} = sub { kill 'TERM', $browser };
my $status;
while (1) {
    my $child = wait();
    if ($child < 0) {
        next if $! == EINTR;
        last;
    }
    $status = $? if $child == $browser;
}
defined $status or die "Chromium exit status unavailable";
exit(WIFSIGNALED($status) ? 128 + WTERMSIG($status) : WEXITSTATUS($status));
