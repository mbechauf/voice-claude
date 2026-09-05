# An accent must not split a word

Written 2026-09-05. Issue #36.

## What was wrong

Saying "switch to the résumé app" did not switch to it. It became an ordinary question
about the "R Sum app".

The phone was not at fault, which is what made it hard to believe. The log has the
phone handing over `Switched to the résumé app`, accents and all, and this app writing
down `switched to the r sum app` a fraction of a second later.

Everywhere speech is reduced to bare words for matching, anything that was not a plain
letter or a digit was replaced **with a space**. So an accented letter did not lose its
accent — it cut the word in half:

    résumé  ->  r     sum
    café    ->  caf
    Zürich  ->  z     rich
    naïve   ->  na    ve

Nothing downstream could recover. The project matcher was hunting for a word that no
longer existed. What finally reached Claude was split too. And the guard on the Mac,
which refuses a tidy-up that invents a word, saw a word invented out of nowhere every
time the tidy-up spelled the name properly.

## What it does now

The mark comes off the letter and the letter stays. Pulling a letter apart into its
plain form and its mark, then dropping the marks, handles nearly all of them at once.
The handful that are their own letters rather than a letter with a mark on it — ø, æ,
ß and a few more — are spelled out by hand.

This is not about one project's name. Every European name and place, and every borrowed
word anybody says out loud, was broken the same way.

## The part that will break again

There are **two copies** of this, and they have to agree letter for letter: one in the
page, because the page decides what is a command the instant it is said and cannot wait
for the Mac; one on the Mac, in the guard that compares a tidy-up against what was
actually said. If they drift apart, the Mac starts throwing away every repair that
spells a name properly — silently, because a refused tidy-up looks exactly like a
sentence that needed no tidying.

So the check runs both over the same words and requires the same answer, rather than
trusting that they stayed in step.

A second thing that will break again: the checks lift working code out of the page and
run it here, and this now sits underneath nearly everything that reads speech. Anything
lifted out has to bring it along. There is one named place that supplies it, and
forgetting it fails loudly rather than quietly.

## What this does not fix

A name the phone mishears into different words is a different problem and this does
nothing for it — "r sum" written as two separate words is two words, and the sounds
are already gone. That is a case for a better ear, not a better clean-up.
